-- Step 4b-4, stage A. `evaluation_nodes`/`evaluation_edges` stop being tables
-- nothing writes and become a FOLD OF THE ASSERTION LOG that can be unfolded.
--
-- This is the ONE additive migration `03-database-design/15_validation_tables.md`
-- §ADDENDUM 2026-08-19 butir 3 declares as a recorded exception to the banner
-- sentence "struktur tabel tidak berubah (nol migration)". That sentence stays
-- true as "nol perubahan struktur SEMANTIK": no existing column changes meaning
-- here, a provenance pointer and two constraints are added. Zero production rows
-- (pre-deploy, preseden D-3, `06-migration-planning/01:7`), and zero rows of any
-- kind — nothing in `src/` referenced either table before this step.
--
-- NOT NULL with no backfill and no nullable interim step, for the reason above and
-- because the only writer (`GraphProjector`, stage B) is holding the assertion row
-- when it folds it. Without the column the executor would have to find an edge's
-- origin by matching the FACT PATTERN back onto the log, which is bug class C-1
-- (`quality-gate/gerbang-mutu-b11-c1-2026-08-18.md`): two authors may assert the
-- same fact, so a pattern cannot name WHICH assertion a retraction acts on.
ALTER TABLE "evaluation_edges" ADD COLUMN     "source_assertion_id" UUID NOT NULL;

-- CreateIndex
--
-- UNIQUE, and on the assertion rather than on the fact. One edge per assertion is
-- the fold's identity: `assert → terminate → assert again` then keeps BOTH rows
-- with their own provenance (the interval set premis §8.3 calls coherent), whereas
-- a unique on (project, source, target, predicate) would make the second assert
-- collide with the row the terminate deliberately left behind — the re-assertion
-- would be lost with every test still green.
--
-- It doubles as the index the composite foreign key below needs, and as the
-- conflict target that makes a redelivered projector event an upsert.
CREATE UNIQUE INDEX "evaluation_edges_source_assertion_id_project_id_key" ON "evaluation_edges"("source_assertion_id", "project_id");

-- `(source_assertion_id, project_id)` rather than the id alone: an edge folded
-- from ANOTHER project's assertion is a tenancy leak the database can refuse
-- outright rather than one that survives until a service forgets to check — the
-- same argument `content_relationships` makes since
-- `20260818140000_relationship_projection_source_assertion`.
--
-- `onDelete: RESTRICT` is load-bearing: an applied effect cannot be deleted
-- through the application (append-only), so this refuses the one route left —
-- hand-run SQL — and refuses it for the right reason. It also fixes the test
-- cleanup order: `evaluation_edges` now has to be deleted BEFORE
-- `transition_effects` (fifth level, projections in front — see
-- `test/helpers/foldCleanup.ts`).
ALTER TABLE "evaluation_edges" ADD CONSTRAINT "evaluation_edges_source_assertion_id_project_id_fkey" FOREIGN KEY ("source_assertion_id", "project_id") REFERENCES "transition_effects"("id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- §ADDENDUM butir 6. The predicate reference takes the 4a shape — the symbol
-- stays in `relationship_type` and the composite key enforces "the predicate
-- belongs to this project" — and `predicate_id` is dropped as a candidate.
--
-- Why this fold needs it too, when `content_relationships` already has it: two
-- folds over the same log must name a predicate the same way, otherwise "which
-- predicate is this" has two answers depending on which table you read. Before
-- this constraint `evaluation_edges.relationship_type` was free TEXT with no
-- enum and no CHECK since `20260711000100_init_schema`, so the diegetic fold
-- could hold a predicate the project does not have.
--
-- `ON UPDATE RESTRICT` is the price, stated rather than discovered: `predicate`
-- is editable by its author, and CASCADE would rewrite stored facts as a side
-- effect of a rename. Refusing the rename while facts still reference the
-- predicate is the failure the author can see and act on — identical to 4a
-- (`20260818120000_content_relationships_predicate_fk`).
ALTER TABLE "evaluation_edges" ADD CONSTRAINT "evaluation_edges_project_id_relationship_type_fkey" FOREIGN KEY ("project_id", "relationship_type") REFERENCES "relationship_definitions"("project_id", "predicate") ON DELETE RESTRICT ON UPDATE RESTRICT;
