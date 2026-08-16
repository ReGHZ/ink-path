import { NarrativeTransitionMapper } from "./NarrativeTransitionMapper.js";
import { NarrativeTransitionRepositoryNotFoundError } from "../../domain/transition/NarrativeTransitionRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type {
  NarrativeTransition,
  NarrativeTransitionSourceType,
} from "../../domain/transition/NarrativeTransition.js";
import type { NarrativeTransitionRepository } from "../../domain/transition/NarrativeTransitionRepository.js";

// `$queryRaw` for the same reason the effect adapter needs it: Prisma has no
// first-class `FOR UPDATE`, and the aggregate-root lock is what keeps a
// concurrent `addEffect` from slipping a child past a delete's guard.
export type NarrativeTransitionDatabase = Pick<
  PrismaClient,
  "narrativeTransition" | "$queryRaw"
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

  async findByIdForUpdate(id: string): Promise<NarrativeTransition | null> {
    // Two statements: the raw one takes the lock, the typed one maps the row.
    // Same split as `PrismaTransitionEffectRepository.findByIdForUpdate`, and
    // for the same reason — mapping raw snake_case columns by hand would
    // duplicate the mapper and drift from it.
    //
    // No SKIP LOCKED: a second structural caller must WAIT and then see the
    // world the first one left, which for a deleted transition means finding no
    // row and answering 404.
    const locked = await this.client.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM narrative_transitions
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;

    if (locked.length === 0) {
      return null;
    }

    return this.findById(id);
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
    // A P2003 here is a Restrict violation from a surviving child effect and is
    // deliberately NOT translated. Two things must be true for it to be
    // unreachable, and BOTH are the caller's: the children are deleted in this
    // same transaction first (`16:138`), and the aggregate-root lock is held so
    // no new child can be born between the two statements
    // (`../../domain/transition/NarrativeTransitionRepository.ts` findByIdForUpdate
    // — the second half was missing until the 7.7 gate). Hitting it therefore
    // means one of those was skipped: a bug that must surface raw.
    const result = await this.client.narrativeTransition.deleteMany({
      where: { id },
    });

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
