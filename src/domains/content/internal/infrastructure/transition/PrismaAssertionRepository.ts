import { AssertionMapper } from "./AssertionMapper.js";
import { NarrativeTransitionRepositoryNotFoundError } from "../../domain/transition/NarrativeTransitionRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { Assertion } from "../../domain/transition/Assertion.js";
import type {
  AssertionClaim,
  AssertionDeletion,
  AssertionRepository,
} from "../../domain/transition/AssertionRepository.js";

// A `Prisma.TransactionClient` satisfies this shape structurally, which is how
// the unit of work hands its transaction in.
//
// `$queryRaw` was part of this type until step 4b-5 and its removal is the point:
// it existed only for `SELECT ... FOR UPDATE`, and no statement here reads a lock
// separately any more. `claimForApply` and `deleteIfPending` carry their predicate
// INSIDE the write, so the statement that decides is the statement that locks.
// Deleted rather than left unused — a raw-SQL door on a type with no raw SQL is a
// capability nobody is guarding (gerbang G2, temuan G2-2).
export type AssertionDatabase = Pick<PrismaClient, "assertion">;

export class PrismaAssertionRepository
  implements AssertionRepository
{
  constructor(private readonly client: AssertionDatabase) {}

  // `narrativeTransitionId: { not: null }` narrows the TABLE to this AGGREGATE.
  // Since the 2026-08-18 migration `assertions` is also the assertion
  // log, so it holds rows that belong to no transition at all. An assertion id
  // handed to this method must answer "no such transition assertion" — which is
  // the truth, and a 404 — instead of reaching a mapper that would reject it
  // with "Narrative transition id is required", a reason that is wrong for a row
  // designed not to have one. findUnique cannot carry the extra predicate,
  // hence findFirst on a unique column.
  async findById(id: string): Promise<Assertion | null> {
    const row = await this.client.assertion.findFirst({
      where: { id, narrativeTransitionId: { not: null } },
    });

    return row ? AssertionMapper.toDomain(row) : null;
  }

  // The unnarrowed twin, step 4b-2. `findUnique` on the primary key with
  // `projectId` in the filter: the id alone is unique, so adding the project can
  // only ever turn a foreign row into null — which is the point, and it is the
  // same 404-not-403 answer the rest of this domain gives.
  async findAssertionById(
    projectId: string,
    id: string,
  ): Promise<Assertion | null> {
    const row = await this.client.assertion.findFirst({
      where: { id, projectId },
    });

    return row ? AssertionMapper.toDomain(row) : null;
  }

  async claimForApply(
    projectId: string,
    id: string,
    now: Date,
  ): Promise<AssertionClaim> {
    // `updateMany` and not `update`: `update` needs a unique WHERE and would
    // reject `appliedAt: null`, which is the whole point — the predicate has to
    // be part of the statement that takes the lock.
    const claimed = await this.client.assertion.updateMany({
      where: { id, projectId, appliedAt: null },
      data: { appliedAt: now },
    });

    const row = await this.client.assertion.findFirst({
      where: { id, projectId },
    });

    if (row === null) {
      return { status: "missing" };
    }

    if (claimed.count === 0) {
      // The read above ran AFTER the update returned zero rows, so under READ
      // COMMITTED it sees the rival's commit — the same fresh-snapshot rule that
      // made the update skip the row in the first place.
      return { status: "already-applied", assertion: AssertionMapper.toDomain(row) };
    }

    // Pre-claim shape, as the port promises: `applied_at` is on disk but the
    // aggregate handed back is still pending, so the service walks the same
    // `markApplied()` path it always did and the final `update()` writes the same
    // instant plus the revision id. Rebuilt from the row rather than read again
    // because a second read would see our own claim.
    return {
      status: "claimed",
      assertion: AssertionMapper.toDomain({
        ...row,
        appliedAt: null,
        contentRevisionId: null,
      }),
    };
  }

  async deleteIfPending(
    projectId: string,
    id: string,
  ): Promise<AssertionDeletion> {
    const deleted = await this.client.assertion.deleteMany({
      where: { id, projectId, appliedAt: null },
    });

    if (deleted.count > 0) {
      return "deleted";
    }

    // Zero rows has two meanings and they are opposite answers to the caller, so
    // the adapter resolves it here rather than handing the ambiguity upwards.
    const survivor = await this.findAssertionById(projectId, id);

    return survivor === null ? "missing" : "applied";
  }

  async findByTransitionId(transitionId: string): Promise<Assertion[]> {
    const rows = await this.client.assertion.findMany({
      where: { narrativeTransitionId: transitionId },
      // Contract of the port: creation order, `id` asc as tie-break. Both bulk
      // apply and the delete guard walk this list to take their row locks, so a
      // stable order is what keeps them from deadlocking against each other.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => AssertionMapper.toDomain(row));
  }

  async insert(assertion: Assertion): Promise<void> {
    // No P2003 translation for `narrative_transition_id`: the service loaded the
    // parent transition before building this assertion, so a violation means the
    // parent was deleted mid-request — rare, and a raw 500 is the honest answer
    // rather than a 404 that implies the assertion was the missing thing.
    await this.client.assertion.create({
      data: {
        id: assertion.id,
        ...AssertionMapper.toPersistence(assertion),
      },
    });
  }

  async update(assertion: Assertion): Promise<void> {
    const result = await this.client.assertion.updateMany({
      where: { id: assertion.id },
      data: AssertionMapper.toUpdatePersistence(assertion),
    });

    if (result.count === 0) {
      throw new NarrativeTransitionRepositoryNotFoundError();
    }
  }

}

// The POOLED instance, and the service uses it for READS ONLY. Every write to
// `assertions` goes through the unit of work: since step 4b-5 each of
// them carries its own predicate (`claimForApply`, `deleteIfPending`), and the
// lock that predicate takes exists only for the length of the transaction the
// unit of work opens.
//
// It is deliberately still the same class rather than a narrow read-only one.
// Half of this surface is meaningless on a pooled client — `claimForApply` most
// obviously, since the lock its statement takes lives only as long as the
// transaction — but a second class would have to duplicate every read method to
// keep the writes out of reach, and two classes over one table is how the two
// drift apart. The port documents the constraint and the unit of work is what
// satisfies it.
export function createAssertionRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): AssertionRepository {
  return new PrismaAssertionRepository(prisma);
}
