import type { QdrantPointPayload } from "../../embedding/qdrantPayload.js";

export type VectorIndexPoint = {
  id: string;
  vector: number[];
  payload: QdrantPointPayload;
};

// §18 skip-decision inputs for one content_field — a small domain-shaped record,
// deliberately NOT the raw Qdrant point/payload (that would leak Qdrant's own
// response shape through the port). Every chunk belonging to the same field in
// one worker run shares identical provenance (all computed once per run, not
// per chunk) — so reading ONE representative point is sufficient; there is no
// need to return every chunk's copy of the same six values.
export type FieldProvenance = {
  contentHash: string;
  icuVersion: string;
  chunkerSourceHash: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingVersion: string;
};

export type VectorIndex = {
  // Idempotent — creates the collection + payload indexes if they don't already
  // exist. Safe to call on every worker startup.
  ensureCollection(): Promise<void>;
  upsertPoints(points: VectorIndexPoint[]): Promise<void>;
  // Full wipe for one entity, every field — used for content.deleted (§6) only.
  // NOT used for the "reprocess this field" case; see deletePointsForField.
  deletePointsForEntity(parameters: {
    projectId: string;
    entityType: string;
    entityId: string;
  }): Promise<void>;
  // Deletes every existing point for one project_id+entity_type+entity_id+
  // content_field combination, regardless of revision_id or chunk_index —
  // the simplified §17 step 12 (05-implementation-policy/03_qdrant_point_id_
  // chunking.md, addendum 2026-07-30): whenever a field is NOT skipped (see
  // §18 and FieldProvenance above), it is deleted-then-rebuilt wholesale for
  // that field, which also closes the orphan-chunk_index gap the old
  // revision_id-only condition had if a field's chunk count shrinks between
  // runs.
  deletePointsForField(parameters: {
    projectId: string;
    entityType: string;
    entityId: string;
    contentField: string;
  }): Promise<void>;
  // Returns null if this field has never been indexed before (first run) —
  // the caller (§18 skip-decision) treats that the same as "provenance
  // differs", i.e. always process a field with no prior provenance.
  getFieldProvenance(parameters: {
    projectId: string;
    entityType: string;
    entityId: string;
    contentField: string;
  }): Promise<FieldProvenance | null>;
};
