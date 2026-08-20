import {
  TransitionEffect,
  type TransitionEffectProperties,
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
  // THE TABLE IS NO LONGER WIDER THAN THE AGGREGATE, and this mapper is where
  // that used to be papered over. Two coercions stood here until step 4b-2:
  // `narrative_transition_id ?? ""` and a cast of `effect_type` past a
  // three-member union. Both were written while the aggregate still modelled only
  // Phase 7's three declarable effects, and both turned a legitimate row into a
  // domain error — a parentless assertion (which step 4b-1 began writing) read
  // back as "Narrative transition id must not be blank", and a `terminate`/
  // `retract` row as "Invalid transition effect type".
  //
  // Nothing had caught it because no read path could reach such a row:
  // `findById` narrows the table to the aggregate with
  // `narrativeTransitionId: { not: null }`. Step 4b-2 adds a read that must NOT
  // narrow — an operation has to be able to load the fact it acts on — so the
  // coercions are gone and the columns are passed through as they are.
  toDomain(row: PrismaTransitionEffect): TransitionEffect {
    const props: TransitionEffectProperties = {
      id: row.id,
      narrativeTransitionId: row.narrativeTransitionId,
      projectId: row.projectId,
      effectType: row.effectType,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      fieldPath: row.fieldPath,
      newValue: row.newValue,
      relationshipType: row.relationshipType,
      relationshipDefinitionId: row.relationshipDefinitionId,
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
      anchorEntityType: row.anchorEntityType,
      anchorEntityId: row.anchorEntityId,
      targetAssertionId: row.targetAssertionId,
      targetEffectType: row.targetEffectType,
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
  // `appliedAt` IS written, `contentRevisionId` is not — and the asymmetry is
  // the step 4b change. The old rule ("every effect is created pending, so a
  // create path able to set applied_at would let a caller declare an effect as
  // already applied") held while a transition was the only writer. Relationship
  // CRUD asserts facts that hold the moment they are written, with no apply step
  // that could ever set the column later.
  //
  // What still forbids the abuse the old rule guarded against is the DOMAIN, not
  // this mapper: `create()` hardcodes `appliedAt: null`, and only
  // `TransitionEffect.assertFact()` — parentless, relationship shapes only — can
  // produce a snapshot carrying a value. This just stops discarding it.
  //
  // `contentRevisionId` stays out: it is a pointer to a revision that apply
  // produces, and an asserted fact produces none.
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
      relationshipDefinitionId: snapshot.relationshipDefinitionId,
      relatedEntityType: snapshot.relatedEntityType,
      relatedEntityId: snapshot.relatedEntityId,
      // Written since step 4b-2. Leaving them out was harmless while every row
      // was a declared effect (all four are null on that path) and is not
      // harmless now: an operation row whose target went unwritten violates
      // `target_matches_operation` at the database, and one whose anchor went
      // unwritten would silently lose its story time.
      anchorEntityType: snapshot.anchorEntityType,
      anchorEntityId: snapshot.anchorEntityId,
      targetAssertionId: snapshot.targetAssertionId,
      targetEffectType: snapshot.targetEffectType,
      appliedAt: snapshot.appliedAt,
      createdAt: snapshot.createdAt,
    };
  },

  // The only two mutable columns in the table, and the write only ever happens
  // inside the transaction whose `claimForApply()` already took this row's lock —
  // which is why there is no version guard to add. Step 4b-5 changed the MECHANISM
  // of that lock, not the argument: the claim is a conditional write
  // (`WHERE id = … AND applied_at IS NULL`), so a rival that lost the claim never
  // reaches this update, and the winner holds the row until it commits. Before
  // 4b-5 the same sentence said `FOR UPDATE`; it was corrected at gerbang G2
  // (G2-2) because it was justifying the ABSENCE of optimistic locking with a
  // lock that had been deleted.
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
