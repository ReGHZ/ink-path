import { NarrativeTransitionMapper } from "./NarrativeTransitionMapper.js";
import { isForeignKeyViolation } from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  NarrativeTransitionRepositoryChildSurvivedError,
  NarrativeTransitionRepositoryNotFoundError,
} from "../../domain/transition/NarrativeTransitionRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type {
  NarrativeTransition,
  NarrativeTransitionSourceType,
} from "../../domain/transition/NarrativeTransition.js";
import type { NarrativeTransitionRepository } from "../../domain/transition/NarrativeTransitionRepository.js";

// `$queryRaw` is gone from this type for the same reason it left the assertion
// adapter at step 4b-5: it carried the aggregate-root `SELECT ... FOR UPDATE`, and
// that lock was removed on purpose. What keeps a concurrent `addAssertion` from
// slipping a child past a delete's guard now is stated in `delete()` below — the
// per-child predicate plus the FK refusing the parent while any child survives.
// Keeping the raw-SQL door open would leave the old mechanism reachable while the
// comment describing it was gone (gerbang G2, temuan G2-2).
export type NarrativeTransitionDatabase = Pick<
  PrismaClient,
  "narrativeTransition"
>;

export class PrismaNarrativeTransitionRepository
  implements NarrativeTransitionRepository
{
  constructor(private readonly client: NarrativeTransitionDatabase) {}

  async findById(id: string): Promise<NarrativeTransition | null> {
    const row = await this.client.narrativeTransition.findUnique({
      where: { id },
    });

    return row ? NarrativeTransitionMapper.toDomain(row) : null;
  }

  async findByProjectId(projectId: string): Promise<NarrativeTransition[]> {
    const rows = await this.client.narrativeTransition.findMany({
      where: { projectId },
      // Contract of the port: newest first, `id` asc as tie-break so rows
      // written inside one transaction still come back in a stable order.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });

    return rows.map((row) => NarrativeTransitionMapper.toDomain(row));
  }

  async findBySourceEntity(
    projectId: string,
    sourceEntityType: NarrativeTransitionSourceType,
    sourceEntityId: string,
  ): Promise<NarrativeTransition[]> {
    const rows = await this.client.narrativeTransition.findMany({
      // Exactly the columns of `@@index([projectId, sourceEntityType,
      // sourceEntityId])` (`prisma/narrative-transition.prisma:33`), in that
      // order.
      where: { projectId, sourceEntityType, sourceEntityId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });

    return rows.map((row) => NarrativeTransitionMapper.toDomain(row));
  }

  async insert(narrativeTransition: NarrativeTransition): Promise<void> {
    // No P2002 branch: this table has no unique index beyond its primary key,
    // whose value comes from IdGenerator. No P2003 branch either — `project_id`
    // and `declared_by_user_id` come from an authorized route context, and
    // `reverses_transition_id` was resolved by the service before this call, so
    // a missing parent is an upstream bug that must surface raw rather than be
    // dressed up as a 404.
    await this.client.narrativeTransition.create({
      data: {
        id: narrativeTransition.id,
        ...NarrativeTransitionMapper.toPersistence(narrativeTransition),
      },
    });
  }

  async update(narrativeTransition: NarrativeTransition): Promise<void> {
    // `updateMany` rather than `update`, even without a version guard: it
    // reports a count instead of throwing Prisma's own P2025, which keeps the
    // zero-row answer in this repository's vocabulary.
    const result = await this.client.narrativeTransition.updateMany({
      where: { id: narrativeTransition.id },
      data: NarrativeTransitionMapper.toUpdatePersistence(narrativeTransition),
    });

    if (result.count === 0) {
      throw new NarrativeTransitionRepositoryNotFoundError();
    }
  }

  async delete(id: string): Promise<void> {
    // Zero rows means gone, and nothing else: with no `version` column there is
    // no second meaning to split out, so the follow-up lookup the relationship
    // repository performs would answer a question nobody asked.
    //
    // A P2003 here is a Restrict violation from a surviving child assertion. Until
    // step 4b-5 it was deliberately NOT translated: the aggregate-root lock made
    // it unreachable, so hitting it meant a caller had skipped something and the
    // raw error was the signal.
    //
    // 4b-5 removed that lock on purpose and put the FK in its place, so this is
    // now a legitimate outcome of a race — a child born after the delete read its
    // list, or applied while it worked. Translated to a NAMED error rather than
    // mapped here, because "which status code" is the application's decision and
    // this class of failure already has an answer there (409, the same sentence
    // the per-child guard gives). Left raw, it answers 500 — measured at 4b-5
    // langkah 2, mutan M3.
    let result;
    try {
      result = await this.client.narrativeTransition.deleteMany({
        where: { id },
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NarrativeTransitionRepositoryChildSurvivedError();
      }

      throw error;
    }

    if (result.count === 0) {
      throw new NarrativeTransitionRepositoryNotFoundError();
    }
  }
}

export function createNarrativeTransitionRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): NarrativeTransitionRepository {
  return new PrismaNarrativeTransitionRepository(prisma);
}
