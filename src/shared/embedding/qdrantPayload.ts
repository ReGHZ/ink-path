import { buildPointKey, derivePointId, type PointKeyParts } from "./pointId.js";

// 05-implementation-policy/03_qdrant_point_id_chunking.md:§5, amended to add
// `embedding_provider` as its own field (addendum 2026-07-29), then `icu_version` +
// `chunker_source_hash` (addendum 2026-07-30). `embedding_model` is the bare model
// name only — provider is no longer encoded into it now that it has a dedicated
// field. `icu_version`/`chunker_source_hash` exist purely as §18 skip-decision
// inputs (via VectorIndex.getFieldProvenance) — see the addendum for why: ICU/
// Unicode segmentation rules bundled with the Node runtime, and the chunking
// algorithm's own implementation, can each change the resulting chunk boundaries
// for unchanged content, independently of content_hash and of each other.
export type QdrantPointPayload = {
  project_id: string;
  entity_type: string;
  entity_id: string;
  content_field: string;
  revision_id: string;
  revision_number: number;
  chunk_index: number;
  chunk_count: number;
  is_current: true;
  content_hash: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_version: string;
  icu_version: string;
  chunker_source_hash: string;
  point_key: string;
  created_at: string;
  content_text_preview?: string;
};

export type BuildQdrantPointInput = PointKeyParts & {
  revisionNumber: number;
  chunkCount: number;
  contentHash: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingVersion: string;
  icuVersion: string;
  chunkerSourceHash: string;
  now: Date;
  contentTextPreview?: string;
};

export type QdrantPoint = {
  id: string;
  payload: QdrantPointPayload;
};

// `chunk_count` here is the count for THIS content_field alone — every field is
// chunked independently (§12-13), not a total across the whole entity.
export function buildQdrantPoint(input: BuildQdrantPointInput): QdrantPoint {
  const pointKey = buildPointKey(input);

  return {
    id: derivePointId(pointKey),
    payload: {
      project_id: input.projectId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      content_field: input.contentField,
      revision_id: input.revisionId,
      revision_number: input.revisionNumber,
      chunk_index: input.chunkIndex,
      chunk_count: input.chunkCount,
      is_current: true,
      content_hash: input.contentHash,
      embedding_provider: input.embeddingProvider,
      embedding_model: input.embeddingModel,
      embedding_version: input.embeddingVersion,
      icu_version: input.icuVersion,
      chunker_source_hash: input.chunkerSourceHash,
      point_key: pointKey,
      created_at: input.now.toISOString(),
      ...(input.contentTextPreview !== undefined
        ? { content_text_preview: input.contentTextPreview }
        : {}),
    },
  };
}
