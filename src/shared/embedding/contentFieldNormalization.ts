// 05-implementation-policy/03_qdrant_point_id_chunking.md:§10-11 — logical content
// sections extracted from a `content` blob (e.g. "Backstory:" heading) become
// `content.{normalized_heading}`. This normalization must be deterministic: it
// feeds into buildPointKey(), so an unstable normalizer would change a chunk's
// point_id across worker runs and break the idempotency guarantee (§18).
export function normalizeContentFieldHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/^#+\s*/, "")
    .replace(/[:#]+$/, "")
    .trim()
    .replaceAll(/\s+/g, "_");
}

export function buildLogicalContentField(heading: string): string {
  return `content.${normalizeContentFieldHeading(heading)}`;
}
