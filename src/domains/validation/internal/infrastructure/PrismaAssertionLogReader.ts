import { isTransientDatabaseError } from "../../../../shared/infrastructure/prismaErrors.js";
import { EvaluationGraphTransientError } from "../domain/EvaluationGraphError.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type {
  AssertionLogReader,
  LoggedAssertion,
  LoggedOperation,
} from "../domain/AssertionLogReader.js";

export type AssertionLogDatabase = Pick<PrismaClient, "assertion">;

export class PrismaAssertionLogReader implements AssertionLogReader {
  constructor(private readonly client: AssertionLogDatabase) {}

  async listOperations(projectId: string): Promise<LoggedOperation[]> {
    return listOperationsImpl(this.client, projectId);
  }

  async findAssertion(input: {
    projectId: string;
    assertionId: string;
  }): Promise<LoggedAssertion | null> {
    // `findFirst` with BOTH columns rather than `findUnique` on the id: the row is
    // reachable by id alone, but reading it that way would let an event from one
    // project fold a row from another. The composite key is the tenancy boundary
    // everywhere else in this schema; a read has no reason to be the exception.
    // Same translation as the write side, and it matters more here than it looks: a
    // read that failed because Postgres blinked must be RETRIED, not dead-lettered.
    // Without this, a blip would turn into "the log does not have this row", which the
    // projector refuses — and the fact would be dropped for a reason that had nothing
    // to do with the fact.
    let row;

    try {
      row = await this.client.assertion.findFirst({
        where: { id: input.assertionId, projectId: input.projectId },
        select: {
          id: true,
          operation: true,
          relationshipType: true,
          targetEntityType: true,
          targetEntityId: true,
          relatedEntityType: true,
          relatedEntityId: true,
          // Is there a `retract` row pointing AT this assertion? Answered in the SAME
          // query, through the self-relation the log already declares
          // (`assertions.target_assertion_id` → `targetedBy`), because the fold
          // asks it on every assert and a second round trip would be a second failure
          // point on the hot path.
          //
          // `take: 1` — existence is the whole question, and no retract-of-a-retract can
          // exist to complicate it (premis §8.3 AMENDMENT 2026-08-18).
          targetedBy: {
            where: { operation: "retract" },
            select: { id: true },
            take: 1,
          },
        },
      });
    } catch (error) {
      throw isTransientDatabaseError(error)
        ? new EvaluationGraphTransientError("findAssertion", error)
        : error;
    }

    if (row === null) {
      return null;
    }

    return {
      id: row.id,
      // No mapping table for `operation` or the entity types: the port's unions and
      // the Prisma enums hold the same members, so these assignments are the CHECK.
      // A tenth `ContentEntityType` or a sixth assertion type breaks `tsc` here, which
      // is where a new log operation SHOULD have to think about the fold.
      operation: row.operation,
      relationshipType: row.relationshipType,
      // Not "was this row deleted" — the log is append-only. It is "the log already holds
      // a withdrawal of this claim", which is what lets the fold refuse to resurrect a
      // retracted fact when the two messages arrive out of order (blokir G4-1).
      retracted: row.targetedBy.length > 0,
      subject: {
        entityType: row.targetEntityType,
        entityId: row.targetEntityId,
      },
      // Both columns are nullable independently in the schema, and one without the
      // other is not an endpoint. Treated as "no object" rather than half-read: the
      // projector refuses unary facts explicitly, with a message naming why, which is
      // a better failure than a node id built from a null.
      object:
        row.relatedEntityType !== null && row.relatedEntityId !== null
          ? { entityType: row.relatedEntityType, entityId: row.relatedEntityId }
          : null,
    };
  }
}

async function listOperationsImpl(
  client: AssertionLogDatabase,
  projectId: string,
): Promise<LoggedOperation[]> {
  try {
    // `created_at` then `id`, and the honest reason is narrower than it first looks
    // (catatan §3, gerbang penutupan 4b-4). Since the `retracted` guard landed, the graph a
    // rebuild produces does NOT depend on this order: only `relationship_add` rows are
    // replayed, each fold is independent and idempotent on its assertion id, and withdrawal
    // is read from the log rather than from replay position.
    //
    // What the order still buys, which is enough to keep it: a deterministic WRITE sequence
    // (same rebuild, same log lines, reproducible failures), and a total one — the timestamp
    // alone is not, because rows written inside one transaction share it. If an operation
    // that depends on position is ever replayed here, the ordering is already correct rather
    // than something to remember.
    return await client.assertion.findMany({
      where: { projectId },
      select: { id: true, operation: true, targetAssertionId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    throw isTransientDatabaseError(error)
      ? new EvaluationGraphTransientError("listOperations", error)
      : error;
  }
}

export function createAssertionLogReader({
  prisma,
}: {
  prisma: PrismaClient;
}): AssertionLogReader {
  return new PrismaAssertionLogReader(prisma);
}
