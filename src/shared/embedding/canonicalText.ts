// 05-implementation-policy/03_qdrant_point_id_chunking.md:§14 — the canonical text
// actually sent to the embedding provider. Deliberately NOT the same text
// computeContentHash() hashes (contentHash.ts hashes the raw/normalized field value
// alone): this block wraps that value with a header that includes `revisionNumber`,
// so it changes every revision even when the field itself didn't — exactly why
// content_hash must never be computed from this instead.
export type ShortFieldCanonicalTextInput = {
  entityType: string;
  entityName: string;
  contentField: string;
  fieldValue: string;
};

export type MediumOrLongFieldCanonicalTextInput = {
  entityType: string;
  entityName: string;
  contentField: string;
  revisionNumber: number;
  fieldContent: string;
};

export function buildShortFieldCanonicalText(
  input: ShortFieldCanonicalTextInput,
): string {
  return [
    `Entity Type: ${input.entityType}`,
    `Entity Name/Title: ${input.entityName}`,
    `Field: ${input.contentField}`,
    `Value: ${input.fieldValue}`,
  ].join("\n");
}

export function buildMediumOrLongFieldCanonicalText(
  input: MediumOrLongFieldCanonicalTextInput,
): string {
  return [
    `Entity Type: ${input.entityType}`,
    `Entity Name/Title: ${input.entityName}`,
    `Field: ${input.contentField}`,
    `Revision: ${input.revisionNumber}`,
    "",
    input.fieldContent,
  ].join("\n");
}
