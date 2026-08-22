-- One WORD = one predicate, for EVERY script — the half of that promise
-- `@@unique([project_id, predicate])` structurally cannot keep.
--
-- Why the symbol index is not enough: `predicate` is DERIVED from the label
-- (`symbolFromLabel`), and the derivation keeps only `[a-z0-9_]`. For a Latin
-- label the word survives the derivation, so `mati (fisik)` and `mati fisik`
-- collide on the symbol and the author is told. For a label no ASCII survives
-- — `結婚`, `الزواج` — the derivation yields nothing and the service mints an
-- OPAQUE symbol (`p_1a2b3c4d`) that is unique BY CONSTRUCTION. So `結婚` typed
-- twice produced two rows reading identically on screen with two different
-- machine identities in an append-only log, and the guarantee held only for
-- authors writing in Latin script — precisely the population `display_label`
-- was added for (gate B8-2,
-- `SaaS/quality-gate/gerbang-mutu-b8-kosakata-2026-08-22.md`).
--
-- Shape of the key, and why each piece:
--   * `btrim(...)`  — the HTTP layer trims and the CHECK forbids blank; this
--     makes the DB the second owner of that rule instead of trusting callers.
--   * `normalize(..., NFKC)` — one word can arrive as different code point
--     sequences (composed vs decomposed Hangul, halfwidth vs fullwidth Kana).
--     IMMUTABLE since PG13, so it is index-safe.
--   * `lower(...)` — letter case never distinguishes two predicates, and the
--     symbol path already lowercases; both paths now say the same thing.
--   * NOT `inverse_display_label`: two predicates may legitimately read the
--     same in the other direction (the 19 seeds default `inverse_label` to the
--     predicate itself), so a unique index there would forbid valid vocabulary.
--
-- The index is the ARBITER, not a check the service runs first: read-before-write
-- is still absent on this path, so two concurrent creates of one word cannot both
-- pass and then both write (the G2 TOCTOU lesson). The service only READS the
-- conflicting row AFTER the write failed, to name it in the 409.
--
-- Declared here rather than in `prisma/relationship-definition.prisma` for the
-- same reason as the two partial unique indexes on
-- `relationship_definition_signatures`: Prisma has no syntax for an index over
-- an EXPRESSION. The schema comment points here.
CREATE UNIQUE INDEX "relationship_definitions_project_display_label_unique"
    ON "relationship_definitions" (
        "project_id",
        lower(normalize(btrim("display_label"), NFKC))
    );
