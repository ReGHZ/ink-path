-- AlterTable
ALTER TABLE "transition_effects" ADD COLUMN     "anchor_entity_id" UUID,
ADD COLUMN     "anchor_entity_type" "NarrativeTransitionSourceType",
ADD COLUMN     "relationship_definition_id" UUID,
ADD COLUMN     "target_assertion_id" UUID,
ALTER COLUMN "narrative_transition_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "transition_effects_project_id_relationship_definition_id_idx" ON "transition_effects"("project_id", "relationship_definition_id");

-- CreateIndex
CREATE INDEX "transition_effects_project_id_anchor_entity_type_anchor_ent_idx" ON "transition_effects"("project_id", "anchor_entity_type", "anchor_entity_id");

-- CreateIndex
CREATE INDEX "transition_effects_target_assertion_id_idx" ON "transition_effects"("target_assertion_id");

-- CreateIndex
CREATE UNIQUE INDEX "transition_effects_id_project_id_key" ON "transition_effects"("id", "project_id");

-- AddForeignKey
ALTER TABLE "transition_effects" ADD CONSTRAINT "transition_effects_relationship_definition_id_project_id_fkey" FOREIGN KEY ("relationship_definition_id", "project_id") REFERENCES "relationship_definitions"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_effects" ADD CONSTRAINT "transition_effects_target_assertion_id_project_id_fkey" FOREIGN KEY ("target_assertion_id", "project_id") REFERENCES "transition_effects"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- An assertion cannot terminate or retract itself. Longer cycles are not
-- reachable through a CHECK, but they are also not expressible: both operations
-- point BACKWARD at a row that already existed.
ALTER TABLE "transition_effects"
    ADD CONSTRAINT "transition_effects_target_not_self"
    CHECK ("target_assertion_id" IS NULL OR "target_assertion_id" <> "id");
