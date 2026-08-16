import {
  NarrativeTransition,
  type NarrativeTransitionProperties,
} from "../../domain/transition/NarrativeTransition.js";

import type {
  NarrativeTransition as PrismaNarrativeTransition,
  Prisma,
} from "../../../../../generated/prisma/client.js";

export const NarrativeTransitionMapper = {
  // No cast on `sourceEntityType`, unlike ContentRelationshipMapper's
  // `relationType`: this column IS a Postgres enum
  // (`prisma/narrative-transition.prisma:1-5`) whose three values are exactly
  // the domain union, so the generated type lines up on its own.
  toDomain(row: PrismaNarrativeTransition): NarrativeTransition {
    const props: NarrativeTransitionProperties = {
      id: row.id,
      projectId: row.projectId,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      title: row.title,
      description: row.description,
      declaredByUserId: row.declaredByUserId,
      reversesTransitionId: row.reversesTransitionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return NarrativeTransition.reconstitute(props);
  },

  // Both timestamps written explicitly, same departure ContentRelationshipMapper
  // documents and for the same reason: declare RETURNS the new transition, so
  // the row and the response body must not come from three different clocks
  // (`../support/ContentRelationshipMapper.ts:48-68`, including the empirical
  // probe that an explicit value beats `@default(now())` and `@updatedAt`).
  // `id` stays out — the service generates it and the repository passes it.
  toPersistence(
    narrativeTransition: NarrativeTransition,
  ): Prisma.NarrativeTransitionUncheckedCreateInput {
    const snapshot = narrativeTransition.toSnapshot();

    return {
      projectId: snapshot.projectId,
      sourceEntityType: snapshot.sourceEntityType,
      sourceEntityId: snapshot.sourceEntityId,
      title: snapshot.title,
      description: snapshot.description,
      declaredByUserId: snapshot.declaredByUserId,
      reversesTransitionId: snapshot.reversesTransitionId,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    };
  },

  // Two human labels and nothing else. The source entity, the reversal link and
  // the declaring user are absent because the aggregate exposes no way to change
  // them — persisting them could only rewrite identical values, or quietly
  // enable a re-point of causality that applied revisions already refer to.
  //
  // No `version: { increment: 1 }` twin of the relationship mapper: this table
  // has no `version` column, so the update is unguarded and last-write-wins for
  // the title. That is a decision recorded at 7.6, not an omission — state never
  // travels this path; `applied_at` lives on the child under a row lock.
  toUpdatePersistence(
    narrativeTransition: NarrativeTransition,
  ): Prisma.NarrativeTransitionUncheckedUpdateManyInput {
    const snapshot = narrativeTransition.toSnapshot();

    return {
      title: snapshot.title,
      description: snapshot.description,
      updatedAt: snapshot.updatedAt,
    };
  },
};
