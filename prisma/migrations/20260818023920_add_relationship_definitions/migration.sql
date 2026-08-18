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
