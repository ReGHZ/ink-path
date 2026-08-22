-- Display text for the project vocabulary — splitting the SYMBOL from the LANGUAGE.
--
-- Why a migration of its own rather than appended to the D-3 squash: that file is
-- already applied and already committed. Touching it again means the file changes
-- while the database does not, and `prisma migrate status` does NOT see that (it
-- compares migration NAMES, not their contents) — a trap that already caught this
-- project once, on 2026-08-20.
--
-- Why the columns need to exist at all:
--   * `predicate` is a MACHINE identifier. The CHECK `^[a-z][a-z0-9_]*$` pins it to
--     ASCII, and the foreign keys from `content_relationships`/`assertions` are
--     `ON UPDATE RESTRICT`, which pins it against renames while any fact names it.
--     Both properties are right for a symbol — and exactly wrong for something a
--     person reads.
--   * `inverse_label` is a symbol too ("display-only symbol", schema comment).
--   * So before this migration the only name an author could ever see was an ASCII
--     symbol. For an author writing in Japanese, Arabic or Russian their vocabulary
--     was NOT EXPRESSIBLE at all — not merely ugly.
--
-- The binding precedent, and the reason this shape is not a preference: Phase 5
-- refused to assume a language. `projects.language` is free text per project; the
-- chunker segments with the root Unicode locale (`Intl.Segmenter("und")`); the
-- embedding model is `paraphrase-multilingual-*`; and there is a test covering
-- mixed Latin and Mandarin inside one field. A vocabulary forced into ASCII would
-- be the single place in this system that assumes a script.
--
-- The division of labour after this migration:
--   `predicate`, `inverse_label`   -> symbols. Machine-facing, stable, never renamed.
--   `display_label`,
--   `inverse_display_label`        -> human text, in the project's language, EDITABLE
--                                     at any time without touching a single fact.
-- That also dissolves half of the rename problem: an author who mistyped the wording
-- edits the text, the symbol does not move, and no fact is disturbed.

ALTER TABLE "relationship_definitions"
    ADD COLUMN "display_label" TEXT,
    ADD COLUMN "inverse_display_label" TEXT;

-- Existing rows (none in dev, but tests seed definitions) get text derived from
-- their symbol: `member_of` -> "member of". Derived, not translated — the author
-- decides the real wording.
UPDATE "relationship_definitions"
SET "display_label" = replace("predicate", '_', ' '),
    "inverse_display_label" = replace("inverse_label", '_', ' ')
WHERE "display_label" IS NULL;

ALTER TABLE "relationship_definitions"
    ALTER COLUMN "display_label" SET NOT NULL,
    ALTER COLUMN "inverse_display_label" SET NOT NULL;

-- Present-but-empty is the easiest way for a display column to start lying: the UI
-- renders an empty string and the author sees a nameless row. No length bound and no
-- charset bound here, both DELIBERATE — length belongs to the HTTP layer, and the
-- charset is precisely what this migration opens up.
ALTER TABLE "relationship_definitions"
    ADD CONSTRAINT "relationship_definitions_display_label_present"
    CHECK (btrim("display_label") <> '' AND btrim("inverse_display_label") <> '');
