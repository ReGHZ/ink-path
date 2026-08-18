-- Step 4b-2. `content_relationships` stops being a table that is written and
-- starts being a FOLD that can be unfolded: the column below names the assertion
-- the row came from, so `retract`/`terminate` can point at the FACT by id
-- instead of describing it by (predicate, endpoints). Premis §8.3 rests on that
-- distinction — both operations are idempotent under retries precisely because
-- they name an assertion id, and two authors are explicitly allowed to assert the
-- same fact, which a pattern match could never tell apart.
--
-- NOT NULL with no backfill and no nullable interim step: pre-deploy, zero
-- production rows (preseden D-3, `06-migration-planning/01:7`), and both writers
-- already hold the value — RelationshipService builds the assertion in the same
-- transaction, and the 7.7 apply path is holding the effect row that IS one.
ALTER TABLE "content_relationships" ADD COLUMN     "source_assertion_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "content_relationships_source_assertion_id_idx" ON "content_relationships"("source_assertion_id");

-- The 2-column unique C-1 removed as an orphan, re-added because it has a real
-- referent again. It is not a revival of the shape C-1 rejected: the assertion
-- self-reference still keys on 3 columns so a `target_effect_type` cannot lie.
-- This one exists for the projection's foreign key below, and it carries
-- `project_id` for the reason every composite key in this schema does.
CREATE UNIQUE INDEX "transition_effects_id_project_id_key" ON "transition_effects"("id", "project_id");

-- `(source_assertion_id, project_id)` rather than the id alone: a projection row
-- folded from ANOTHER project's assertion is a tenancy leak the database can
-- refuse outright rather than one that survives until a service forgets to
-- check — the same argument the two foreign keys added in
-- `20260818030100_generalise_transition_effects_into_assertion_log` already make.
--
-- `onDelete: RESTRICT` is load-bearing: an applied effect cannot be deleted
-- through the application (append-only), so this refuses the one route left —
-- hand-run SQL — and refuses it for the right reason. A projection row whose
-- origin assertion was deleted could no longer say what fact it is a fold of.
ALTER TABLE "content_relationships" ADD CONSTRAINT "content_relationships_source_assertion_id_project_id_fkey" FOREIGN KEY ("source_assertion_id", "project_id") REFERENCES "transition_effects"("id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
