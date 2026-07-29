import { createHash } from "node:crypto";

// Hashes the raw field text alone — deliberately NOT the full §14 canonical
// text block, which wraps the field in a header that includes
// `Revision: {revision_number}`. Hashing that header would make content_hash
// change on every single revision even when this particular field's text is
// untouched, defeating the one thing §18 uses it for: skipping re-embedding
// of fields that didn't actually change.
export function computeContentHash(normalizedFieldText: string): string {
  return createHash("sha256").update(normalizedFieldText, "utf8").digest("hex");
}
