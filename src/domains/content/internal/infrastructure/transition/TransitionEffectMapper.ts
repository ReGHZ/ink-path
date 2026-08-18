import {
  TransitionEffect,
  type TransitionEffectProperties,
  type TransitionEffectType,
} from "../../domain/transition/TransitionEffect.js";

import type {
  TransitionEffect as PrismaTransitionEffect,
  Prisma,
} from "../../../../../generated/prisma/client.js";

export const TransitionEffectMapper = {
  // `relationshipType` needs no cast even though it is plain TEXT: the domain
  // property is `string | null` too, and rule 1 is enforced by
  // `reconstitute()` → `validate()`, which is where a value outside the registry
  // must be rejected rather than screened out silently at this boundary.
  //
  // Two columns DO need a cast since the 2026-08-18 migration, and for the same
  // reason: the TABLE is now wider than this AGGREGATE. `transition_effects` is
  // also the assertion log, so `narrative_transition_id` is nullable and
  // `effect_type` carries `terminate`/`retract`. Both casts land on checks
  // `validate()` already had — an empty transition id is "Narrative transition
  // id is required", and an operation outside the union falls to the switch
  // `default:` as "Invalid transition effect type". This is exactly the "value
  // cast past the union" that the domain's own defence-in-depth comment
  // anticipates, so the rejection stays where the aggregate can state its reason
  // rather than being screened out silently here.
  toDomain(row: PrismaTransitionEffect): TransitionEffect {
    const props: TransitionEffectProperties = {
      id: row.id,
      narrativeTransitionId: row.narrativeTransitionId ?? "",
      projectId: row.projectId,
      effectType: row.effectType as TransitionEffectType,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      fieldPath: row.fieldPath,
      newValue: row.newValue,
      relationshipType: row.relationshipType,
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
      appliedAt: row.appliedAt,
      contentRevisionId: row.contentRevisionId,
      createdAt: row.createdAt,
    };

    return TransitionEffect.reconstitute(props);
  },

  // `createdAt` explicit, `updatedAt` absent — this table has no such column
  // (`prisma/narrative-transition.prisma:38-60`), which is itself a statement:
  // an effect's intent never changes, so there is no "last modified" to record.
  // Only `applied_at` moves, once.
  //
  // `appliedAt` and `contentRevisionId` are not written here either. Every
  // effect is created pending, and the column defaults to null; a create path
  // able to set them would be a way to declare an effect as already applied,
  // which is exactly the state the domain forbids on construction.
  toPersistence(
    transitionEffect: TransitionEffect,
  ): Prisma.TransitionEffectUncheckedCreateInput {
    const snapshot = transitionEffect.toSnapshot();

    return {
      narrativeTransitionId: snapshot.narrativeTransitionId,
      projectId: snapshot.projectId,
      effectType: snapshot.effectType,
      targetEntityType: snapshot.targetEntityType,
      targetEntityId: snapshot.targetEntityId,
      fieldPath: snapshot.fieldPath,
      newValue: snapshot.newValue,
      relationshipType: snapshot.relationshipType,
      relatedEntityType: snapshot.relatedEntityType,
      relatedEntityId: snapshot.relatedEntityId,
      createdAt: snapshot.createdAt,
    };
  },

  // The only two mutable columns in the table, and the write only ever happens
  // inside the transaction that holds this row's `FOR UPDATE` lock — which is
  // why there is no version guard to add.
  toUpdatePersistence(
    transitionEffect: TransitionEffect,
  ): Prisma.TransitionEffectUncheckedUpdateManyInput {
    const snapshot = transitionEffect.toSnapshot();

    return {
      appliedAt: snapshot.appliedAt,
      contentRevisionId: snapshot.contentRevisionId,
    };
  },
};
