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
