-- AlterTable
ALTER TABLE "transition_effects" ADD COLUMN     "anchor_entity_id" UUID,
ADD COLUMN     "anchor_entity_type" "NarrativeTransitionSourceType",
ADD COLUMN     "relationship_definition_id" UUID,
ADD COLUMN     "target_assertion_id" UUID,
ADD COLUMN     "target_effect_type" "TransitionEffectType",
ALTER COLUMN "narrative_transition_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "transition_effects_project_id_relationship_definition_id_idx" ON "transition_effects"("project_id", "relationship_definition_id");

-- CreateIndex
CREATE INDEX "transition_effects_project_id_anchor_entity_type_anchor_ent_idx" ON "transition_effects"("project_id", "anchor_entity_type", "anchor_entity_id");

-- CreateIndex
CREATE INDEX "transition_effects_target_assertion_id_idx" ON "transition_effects"("target_assertion_id");

-- CreateIndex
CREATE UNIQUE INDEX "transition_effects_id_project_id_effect_type_key" ON "transition_effects"("id", "project_id", "effect_type");

-- AddForeignKey
ALTER TABLE "transition_effects" ADD CONSTRAINT "transition_effects_relationship_definition_id_project_id_fkey" FOREIGN KEY ("relationship_definition_id", "project_id") REFERENCES "relationship_definitions"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_effects" ADD CONSTRAINT "transition_effects_target_assertion_id_project_id_target_e_fkey" FOREIGN KEY ("target_assertion_id", "project_id", "target_effect_type") REFERENCES "transition_effects"("id", "project_id", "effect_type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written below this line. Making `narrative_transition_id` nullable
-- removes the only thing that used to guarantee every row had a provenance and
-- an anchor; these four constraints are what replaces it. Same split as
-- `init_constraints`.
-- ─────────────────────────────────────────────────────────────────────────────

-- An anchor is a (type, id) pair or it is absent. Half an anchor is a row that
-- claims a story time it cannot name, and it would fold into the wrong answer
-- silently rather than fail.
ALTER TABLE "transition_effects"
    ADD CONSTRAINT "transition_effects_anchor_complete"
    CHECK (("anchor_entity_type" IS NULL) = ("anchor_entity_id" IS NULL));

-- Every row belongs to a transition (Phase 7's declared change) or names a
-- predicate definition (an assertion made directly). A row with neither has no
-- provenance at all — nothing says who claimed it or what it claims. Holds for
-- every row written before this migration, all of which have a parent.
ALTER TABLE "transition_effects"
    ADD CONSTRAINT "transition_effects_has_provenance"
    CHECK ("narrative_transition_id" IS NOT NULL OR "relationship_definition_id" IS NOT NULL);

-- `terminate` and `retract` act ON an assertion, so they are meaningless without
-- one; the other three describe a fact of their own and must not point at one.
-- Written as a single equivalence rather than two one-way rules so neither
-- direction can be added without the other.
ALTER TABLE "transition_effects"
    ADD CONSTRAINT "transition_effects_target_matches_operation"
    CHECK (
        ("effect_type" IN ('terminate', 'retract')) = ("target_assertion_id" IS NOT NULL)
    );

-- Asking that a target EXISTS is not the same as asking WHAT IT IS, and the
-- three rules below are the second question. A CHECK only ever sees its own row,
-- so the target's kind is carried on the referencing row and the composite
-- foreign key above is what stops it from lying: a `target_effect_type`
-- disagreeing with the target's real `effect_type` has no row to reference.
-- Append-only makes that permanent — `effect_type` is never updated, so the
-- reference can never go stale. A trigger would buy the same rule at the price
-- of a second place for the invariant to live.
--
-- The kind is present exactly when the target is. Same equivalence shape as
-- `anchor_complete`, so neither half can arrive without the other: a target
-- whose kind went unstated would make both rules below vacuously true.
ALTER TABLE "transition_effects"
    ADD CONSTRAINT "transition_effects_target_kind_complete"
    CHECK (("target_assertion_id" IS NULL) = ("target_effect_type" IS NULL));

-- `terminate` is valid-time: it ends the range of a FACT. An operation has no
-- range to end, so terminating one is not a harmless no-op — it is a sentence
-- with no meaning.
ALTER TABLE "transition_effects"
    ADD CONSTRAINT "transition_effects_terminate_targets_assertion"
    CHECK (
        "effect_type" <> 'terminate'
        OR "target_effect_type" IN ('attribute_change', 'relationship_add', 'relationship_remove')
    );

-- `retract` is transaction-time: it says a CLAIM was never made. A `terminate`
-- row IS a claim ("this fact stops at anchor T"), so retracting one is the
-- correction path for a mistyped termination — and, this log being append-only,
-- the only one. Forbidding it would make a mistyped termination permanent and
-- force a new operation (`unterminate`) into existence later.
--
-- A `retract` is deliberately NOT on the list. Retracting a retraction is double
-- negation: it would resurrect an assertion and force the reader to resolve
-- retractions transitively instead of as a flat set. Listed positively rather
-- than as a NOT IN, so a future member of the enum is refused until someone
-- decides where it belongs rather than admitted by silence.
--
-- Premis §8.3 AMENDMENT 2026-08-18.
ALTER TABLE "transition_effects"
    ADD CONSTRAINT "transition_effects_retract_targets_assertion_or_terminate"
    CHECK (
        "effect_type" <> 'retract'
        OR "target_effect_type" IN ('attribute_change', 'relationship_add', 'relationship_remove', 'terminate')
    );

-- An assertion cannot terminate or retract itself. Longer cycles are not
-- reachable through a CHECK, but they are also not expressible: both operations
-- point BACKWARD at a row that already existed.
ALTER TABLE "transition_effects"
    ADD CONSTRAINT "transition_effects_target_not_self"
    CHECK ("target_assertion_id" IS NULL OR "target_assertion_id" <> "id");
