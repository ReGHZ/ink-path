// Narrow read-only port for the embedding worker (05-implementation-policy/
// 03_qdrant_point_id_chunking.md:§17 step 3) to load a content entity's
// indexable fields, regardless of which of the 5 (soon 9, Phase 6) domain
// entity classes it actually is. Deliberately NOT the underlying repositories
// (findById/insert/update/delete/linkRevision) — the embedding worker only
// ever needs to READ indexable field values, so it's given exactly that,
// following the same narrow-port pattern already used for EmbeddingProvider,
// VectorIndex, and Consumer. The concrete implementation lives inside the
// Content domain (which has real access to all 5 repositories + domain
// classes) and is registered via domains/content/register.ts — this type
// only describes the contract, same division as every other port here.
export type FieldClassification = "short" | "medium";

// value + classification travel together as one unit per field, not as two
// separately-keyed lookups (fieldValues vs fieldClassifications) — the two
// pieces can never drift out of sync for a given field because there is only
// one place to write both at once. Same reasoning applies one level up: each
// entity type's extraction logic is one combined descriptor (see the
// concrete implementation), not a repo-dispatch table and a field-mapping
// table maintained independently.
export type IndexableField = {
  value: string | null;
  classification: FieldClassification;
};

export type IndexableContentEntity = {
  projectId: string;
  entityName: string;
  currentRevisionId: string;
  // `content` is handled separately from `fields` — every entity type has it,
  // it's always a "long" field (chunked via shared/embedding/chunker.ts),
  // never short/medium classified like the fields below (05-implementation-
  // policy/03_qdrant_point_id_chunking.md:§13).
  content: string | null;
  fields: Record<string, IndexableField>;
};

export type ContentEntityReader = {
  // Returns null only when entityId genuinely doesn't exist — an expected,
  // normal race (entity deleted, or a later revision already superseded this
  // one, between the event being created and processed; §17 step 4-5 is the
  // caller's actual staleness guard, this port doesn't attempt to detect
  // staleness itself). An unrecognized entityType is a DIFFERENT condition —
  // a configuration/version mismatch (event schema drifted ahead of what
  // this reader supports, e.g. a Phase 6 entity type arriving before its
  // descriptor is added) — and throws instead of returning null, so it's
  // loud rather than silently treated the same as "not found".
  read(parameters: {
    entityType: string;
    entityId: string;
  }): Promise<IndexableContentEntity | null>;
};
