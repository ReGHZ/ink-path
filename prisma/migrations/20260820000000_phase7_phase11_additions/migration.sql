-- Peleburan D-3 (2026-08-20) — SATU migrasi aditif menggantikan DELAPAN.
--
-- Tiga migrasi baseline (`init_extensions`, `init_schema`, `init_constraints`)
-- SENGAJA TIDAK DISENTUH: mereka bukti asal-usul schema 6-domain, dan
-- `init_constraints` memegang 23 CHECK + 13 index parsial yang tidak bisa
-- diturunkan Prisma dari `schema.prisma`. Yang dilebur hanya yang datang
-- SESUDAHNYA, dan kedelapan itu terbukti MURNI ADITIF: nol `DROP COLUMN`, nol
-- rename, satu-satunya pelemahan adalah `DROP NOT NULL` di
-- `transition_effects.narrative_transition_id`.
--
-- Karena itu peleburannya VERBATIM, bukan di-regenerate. `prisma migrate diff`
-- tidak dipakai dengan sengaja: ia tidak memodelkan CHECK constraint maupun
-- index parsial, jadi meregenerate baseline dari `schema.prisma` akan
-- MENGHILANGKAN 32 CHECK dan 15 index parsial tanpa satu pun error.
--
-- Yang digabung, dalam urutan aslinya:
--   1. 20260716053704_add_version_columns
--   2. 20260803065140_add_outbox_status_locked_at_index
--   3. 20260818023920_add_relationship_definitions
--   4. 20260818030000_add_assertion_effect_types
--   5. 20260818030100_generalise_transition_effects_into_assertion_log
--   6. 20260818120000_content_relationships_predicate_fk
--   7. 20260818140000_relationship_projection_source_assertion
--   8. 20260819120000_evaluation_edge_provenance_and_predicate_fk
--
-- Bukti kesetaraan: `pg_dump --schema-only` atas DB hasil 11 migrasi lama vs DB
-- hasil 4 migrasi ini dibandingkan baris-per-baris (nol selisih). Preseden D-3
-- + izin menulis ulang migrasi pre-deploy: `06-migration-planning/01`.


-- ============================================================
-- dari: 20260716053704_add_version_columns
-- ============================================================

-- AlterTable
ALTER TABLE "chapters" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "content_relationships" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "factions" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "layers" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "maps" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "plots" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_projects" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "world_elements" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;


-- ============================================================
-- dari: 20260803065140_add_outbox_status_locked_at_index
-- ============================================================

-- CreateIndex
CREATE INDEX "outbox_events_status_locked_at_idx" ON "outbox_events"("status", "locked_at");


-- ============================================================
-- dari: 20260818023920_add_relationship_definitions
-- ============================================================

-- CreateEnum
CREATE TYPE "RelationDirectionality" AS ENUM ('directional', 'non_directional');

-- CreateTable
CREATE TABLE "relationship_definitions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "predicate" TEXT NOT NULL,
    "object_required" BOOLEAN NOT NULL,
    "directionality" "RelationDirectionality" NOT NULL,
    "inverse_label" TEXT NOT NULL,
    "transitive" BOOLEAN NOT NULL DEFAULT false,
    "subclass_of_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationship_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_definition_signatures" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "subject_entity_type" "ContentEntityType" NOT NULL,
    "object_entity_type" "ContentEntityType",

    CONSTRAINT "relationship_definition_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "relationship_definitions_project_id_idx" ON "relationship_definitions"("project_id");

-- CreateIndex
CREATE INDEX "relationship_definitions_subclass_of_id_idx" ON "relationship_definitions"("subclass_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_definitions_project_id_predicate_key" ON "relationship_definitions"("project_id", "predicate");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_definitions_id_project_id_key" ON "relationship_definitions"("id", "project_id");

-- CreateIndex
CREATE INDEX "relationship_definition_signatures_definition_id_idx" ON "relationship_definition_signatures"("definition_id");

-- AddForeignKey
ALTER TABLE "relationship_definitions" ADD CONSTRAINT "relationship_definitions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_definitions" ADD CONSTRAINT "relationship_definitions_subclass_of_id_project_id_fkey" FOREIGN KEY ("subclass_of_id", "project_id") REFERENCES "relationship_definitions"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_definition_signatures" ADD CONSTRAINT "relationship_definition_signatures_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "relationship_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written below this line. Prisma cannot express partial unique indexes or
-- CHECK constraints, and both carry invariants that the frozen registry
-- currently enforces in TypeScript. Same split as `init_constraints`.
-- ─────────────────────────────────────────────────────────────────────────────

-- A signature set must not admit the same combination twice. Split in two
-- because `object_entity_type` is nullable for unary predicates, and Postgres
-- treats NULLs as distinct inside a plain unique index — a single composite
-- unique would happily store `(d, character, NULL)` any number of times. Same
-- pattern as `rule_dependency_index_unique_attr` / `..._unique_entity`.
CREATE UNIQUE INDEX "relationship_definition_signatures_unique_binary"
    ON "relationship_definition_signatures" ("definition_id", "subject_entity_type", "object_entity_type")
    WHERE "object_entity_type" IS NOT NULL;

CREATE UNIQUE INDEX "relationship_definition_signatures_unique_unary"
    ON "relationship_definition_signatures" ("definition_id", "subject_entity_type")
    WHERE "object_entity_type" IS NULL;

-- Registry Rule 11 (§5, §7.3): structural hierarchy has dedicated FK columns
-- (`layers.parent_id`, `maps.parent_id`, `scenes.chapter_id`) and must never be
-- expressed as a generic relationship. Today `assertNoHierarchyPairs()` enforces
-- this over a frozen constant at module load. Once the matrix is project data
-- that check has nothing to run against at boot, and §4 REVISI(b) is explicit
-- that the ban has to move to definition-write time or it "hilang senyap".
--
-- chapter/scene is banned in BOTH directions, matching the order-insensitive
-- comparison the registry uses today; per-type bans were rejected there because
-- they need re-auditing every time the vocabulary grows.
ALTER TABLE "relationship_definition_signatures"
    ADD CONSTRAINT "relationship_definition_signatures_no_dedicated_hierarchy"
    CHECK (
        "object_entity_type" IS NULL
        OR NOT (
               ("subject_entity_type" = 'layer'   AND "object_entity_type" = 'layer')
            OR ("subject_entity_type" = 'map'     AND "object_entity_type" = 'map')
            OR ("subject_entity_type" = 'chapter' AND "object_entity_type" = 'scene')
            OR ("subject_entity_type" = 'scene'   AND "object_entity_type" = 'chapter')
        )
    );

-- The predicate is the machine's symbol, and nothing downstream inspects it for
-- meaning — that is the whole point of the new premise, and it is also why a
-- malformed one cannot be detected later. `relation_type` was left free text in
-- `init_schema` with a TypeScript union as its only guard; a project-owned
-- vocabulary has no such union, so the shape constraint moves to the column.
ALTER TABLE "relationship_definitions"
    ADD CONSTRAINT "relationship_definitions_predicate_format"
    CHECK ("predicate" ~ '^[a-z][a-z0-9_]*$');

-- A predicate cannot be its own parent. Longer cycles are not reachable through
-- a CHECK; the closure that walks this edge lives in the projection (Aturan A1)
-- and is where cycle handling belongs.
ALTER TABLE "relationship_definitions"
    ADD CONSTRAINT "relationship_definitions_subclass_not_self"
    CHECK ("subclass_of_id" IS NULL OR "subclass_of_id" <> "id");


-- ============================================================
-- dari: 20260818030000_add_assertion_effect_types
-- ============================================================

-- Split from the migration that follows it, and not for tidiness: Postgres
-- refuses to USE an enum value in the same transaction that adds it ("unsafe use
-- of new value of enum type"). The next migration writes CHECK constraints that
-- name 'terminate' and 'retract', so the values have to be committed first.

-- AlterEnum
ALTER TYPE "TransitionEffectType" ADD VALUE 'terminate';
ALTER TYPE "TransitionEffectType" ADD VALUE 'retract';


-- ============================================================
-- dari: 20260818030100_generalise_transition_effects_into_assertion_log
-- ============================================================

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


-- ============================================================
-- dari: 20260818120000_content_relationships_predicate_fk
-- ============================================================

-- Step 4 of the interleaved work order
-- (`07-implementation-order/01_implementation_order.md` §Langkah 4 butir 5):
-- `content_relationships.relation_type` becomes a reference to the project's own
-- predicate vocabulary.
--
-- What this replaces: a 17-member TypeScript union
-- (`relationTypeRegistry.ts`, deleted in the same step) that could only bind
-- callers who went through the domain entity. The column itself was plain TEXT
-- with no enum and no CHECK since `20260711000100_init_schema`.
--
-- COMPOSITE on (project_id, relation_type), not a definition_id column:
--
--   * the predicate is project-scoped, so the pair is exactly the invariant that
--     must hold — a relationship may not borrow another project's vocabulary,
--     and the database can refuse that outright rather than trusting a service
--     to compare two ids;
--   * the symbol stays in the row, so every read that only needs the name — the
--     whole CRUD surface — keeps working without a join.
--
-- ON UPDATE RESTRICT is deliberate, and the one clause worth arguing about.
-- `predicate` is editable by its author, unlike `effect_type` in the C-1 pattern
-- this otherwise resembles. CASCADE would rewrite stored facts as a side effect
-- of a rename; RESTRICT refuses the rename while relationships still reference
-- the predicate, which is a failure the author can see and act on.
--
-- ON DELETE RESTRICT for the same reason as every other Restrict here: deleting
-- a predicate out from under the rows that use it would leave the projection
-- describing facts in a vocabulary the project no longer has.
--
-- Pre-deploy, zero rows: no backfill, no staged rollout, no compatibility
-- window (`06-migration-planning/01_migration_plan.md:7`, precedent D-3).
ALTER TABLE "content_relationships"
    ADD CONSTRAINT "content_relationships_project_id_relation_type_fkey"
    FOREIGN KEY ("project_id", "relation_type")
    REFERENCES "relationship_definitions" ("project_id", "predicate")
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;


-- ============================================================
-- dari: 20260818140000_relationship_projection_source_assertion
-- ============================================================

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


-- ============================================================
-- dari: 20260819120000_evaluation_edge_provenance_and_predicate_fk
-- ============================================================

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


-- ============================================================
-- Rename terminologi: transition effect → ASSERTION (2026-08-20)
-- ============================================================
--
-- Tabelnya lahir sebagai "efek transisi" dan sekarang bukan itu lagi: sejak
-- langkah 4b ia log assertion, dan barisnya bisa lahir dari CRUD tanpa induk
-- transisi (`narrative_transition_id` nullable di migrasi ini). Kolom yang
-- MENUNJUK-nya sudah lebih dulu bernama benar (`source_assertion_id` di
-- `content_relationships` dan `evaluation_edges`, relasi `AssertionTarget`),
-- jadi nama tabel + enum-lah yang ketinggalan.
--
-- Rename ditempel di sini, BUKAN dengan mengubah `init_schema`: tiga migrasi
-- baseline dipertahankan sebagai bukti asal-usul (keputusan user 2026-08-20).
--
-- Postgres TIDAK ikut mengganti nama constraint/index saat tabel di-rename,
-- jadi kesebelas constraint + kesepuluh index ikut di-rename satu-satu. Kalau
-- dilewat, `pg_dump` akan menampilkan nama lama di tabel bernama baru — dan
-- nama itulah yang muncul di pesan error Postgres saat ada yang melanggarnya.
--
-- Yang SENGAJA tidak ikut: routing key `narrative.effect.*` (kontrak event,
-- punya test kontrak sendiri), nilai enum (`attribute_change`,
-- `relationship_add`, `relationship_remove`, `terminate`, `retract` — itu
-- semantik, bukan istilah), dan tabel `narrative_transitions` (ia memang transisi).

ALTER TABLE "transition_effects" RENAME TO "assertions";
ALTER TYPE "TransitionEffectType" RENAME TO "AssertionOperation";
ALTER TABLE "assertions" RENAME COLUMN "effect_type" TO "operation";
ALTER TABLE "assertions" RENAME COLUMN "target_effect_type" TO "target_operation";

ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_pkey" TO "assertions_pkey";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_anchor_complete" TO "assertions_anchor_complete";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_has_provenance" TO "assertions_has_provenance";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_retract_targets_assertion_or_terminate" TO "assertions_retract_targets_assertion_or_terminate";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_target_kind_complete" TO "assertions_target_kind_complete";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_target_matches_operation" TO "assertions_target_matches_operation";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_target_not_self" TO "assertions_target_not_self";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_terminate_targets_assertion" TO "assertions_terminate_targets_assertion";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_narrative_transition_id_fkey" TO "assertions_narrative_transition_id_fkey";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_relationship_definition_id_project_id_fkey" TO "assertions_relationship_definition_id_project_id_fkey";
ALTER TABLE "assertions" RENAME CONSTRAINT "transition_effects_target_assertion_id_project_id_target_e_fkey" TO "assertions_target_assertion_id_project_id_target_operation_fkey";

ALTER INDEX "transition_effects_id_project_id_effect_type_key" RENAME TO "assertions_id_project_id_operation_key";
ALTER INDEX "transition_effects_id_project_id_key" RENAME TO "assertions_id_project_id_key";
ALTER INDEX "transition_effects_narrative_transition_id_idx" RENAME TO "assertions_narrative_transition_id_idx";
ALTER INDEX "transition_effects_narrative_transition_id_applied_at_idx" RENAME TO "assertions_narrative_transition_id_applied_at_idx";
ALTER INDEX "transition_effects_project_id_target_entity_type_target_ent_idx" RENAME TO "assertions_project_id_target_entity_type_target_entity_id_idx";
ALTER INDEX "transition_effects_project_id_relationship_definition_id_idx" RENAME TO "assertions_project_id_relationship_definition_id_idx";
ALTER INDEX "transition_effects_project_id_anchor_entity_type_anchor_ent_idx" RENAME TO "assertions_project_id_anchor_entity_type_anchor_entity_id_idx";
ALTER INDEX "transition_effects_target_assertion_id_idx" RENAME TO "assertions_target_assertion_id_idx";
ALTER INDEX "transition_effects_by_content_revision" RENAME TO "assertions_by_content_revision";
ALTER INDEX "transition_effects_pending_by_entity" RENAME TO "assertions_pending_by_entity";
