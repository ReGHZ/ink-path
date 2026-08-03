import { QdrantClient } from "@qdrant/js-client-rest";

import type {
  FieldProvenance,
  VectorIndex,
  VectorIndexPoint,
} from "../../shared/application/ports/VectorIndex.js";
import type { QdrantPointPayload } from "../../shared/embedding/qdrantPayload.js";

// Single collection for every content entity type (Layer, WorldMap, WorldElement, Faction,
// Character, ...) — not one collection per entity type. `entity_type` is already a mandatory
// payload field (05-implementation-policy/03_qdrant_point_id_chunking.md:§5), and retrieval
// needs to search across entity types within a project (§15-16 make entity_type an OPTIONAL
// filter, not a boundary). See notes/phase-5-embedding-worker-qdrant.md for full reasoning.
export const CONTENT_EMBEDDINGS_COLLECTION = "content_embeddings";

// 768 — native output size of the currently-implemented local embedding model
// (paraphrase-multilingual-mpnet-base-v2). Several cloud embedding providers (e.g. Gemini's
// `output_dimensionality`, OpenAI's `dimensions`) support truncating their native output to
// 768 via an official API parameter (Matryoshka Representation Learning), so this stays a
// viable target if/when a cloud provider is added — but which provider(s) that will be is
// NOT decided yet (no vendor chosen for prod; only `local` exists in code today).
//
// Known per-vendor asymmetry to check when building a new EmbeddingProvider: some providers
// re-normalize a truncated vector server-side, some don't — leaving unit-norm to the caller.
// This collection uses Cosine distance, and Qdrant normalizes vectors internally for Cosine
// comparisons, so a non-unit-norm stored vector does not affect similarity ranking
// correctness here. Every provider should still explicitly request/assert dimension === 768
// rather than assume it — changing this constant later requires recreating the collection
// and re-embedding all existing content, so treat it as the one hard coupling point when
// picking a prod vendor.
const VECTOR_SIZE = 768;

// project_id/entity_id: exact-match `keyword`. is_current: `bool`. entity_type/content_field:
// `keyword` (content_field has open cardinality from parsed content sections, §10-11, which
// `keyword` handles fine — unlike a numeric index). project_id + is_current are mandatory on
// every retrieval query (§15); entity_id is not a §15 filter at all — it's what the worker
// itself needs for content.deleted / stale-revision cleanup (§6, §18). Full per-field reasoning:
// notes/phase-5-embedding-worker-qdrant.md.
const PAYLOAD_INDEXES: ReadonlyArray<{
  field: string;
  schema: "keyword" | "bool";
}> = [
  { field: "project_id", schema: "keyword" },
  { field: "entity_id", schema: "keyword" },
  { field: "is_current", schema: "bool" },
  { field: "entity_type", schema: "keyword" },
  { field: "content_field", schema: "keyword" },
];

export class QdrantVectorIndex implements VectorIndex {
  constructor(private readonly client: QdrantClient) {}

  async ensureCollection(): Promise<void> {
    const { exists } = await this.client.collectionExists(
      CONTENT_EMBEDDINGS_COLLECTION,
    );

    if (!exists) {
      await this.client.createCollection(CONTENT_EMBEDDINGS_COLLECTION, {
        vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      });
    }

    // createPayloadIndex is idempotent — re-creating an index that already exists
    // with the same schema is a no-op, not an error. Safe to run unconditionally
    // every time, including on an already-bootstrapped collection.
    for (const { field, schema } of PAYLOAD_INDEXES) {
      // `wait: true` — without it, createPayloadIndex only acknowledges the
      // request; the index isn't guaranteed to show up in getCollection() (or be
      // usable) by the time this call returns, which breaks the "ensureCollection()
      // resolved => collection is actually ready" contract callers rely on.
      await this.client.createPayloadIndex(CONTENT_EMBEDDINGS_COLLECTION, {
        field_name: field,
        field_schema: schema,
        wait: true,
      });
    }
  }

  async upsertPoints(points: VectorIndexPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }

    await this.client.upsert(CONTENT_EMBEDDINGS_COLLECTION, {
      points: points.map((point) => ({
        id: point.id,
        vector: point.vector,
        payload: point.payload,
      })),
    });
  }

  async deletePointsForEntity(parameters: {
    projectId: string;
    entityType: string;
    entityId: string;
  }): Promise<void> {
    await this.client.delete(CONTENT_EMBEDDINGS_COLLECTION, {
      filter: {
        must: [
          { key: "project_id", match: { value: parameters.projectId } },
          { key: "entity_type", match: { value: parameters.entityType } },
          { key: "entity_id", match: { value: parameters.entityId } },
        ],
      },
    });
  }

  async deletePointsForField(parameters: {
    projectId: string;
    entityType: string;
    entityId: string;
    contentField: string;
  }): Promise<void> {
    await this.client.delete(CONTENT_EMBEDDINGS_COLLECTION, {
      filter: {
        must: [
          { key: "project_id", match: { value: parameters.projectId } },
          { key: "entity_type", match: { value: parameters.entityType } },
          { key: "entity_id", match: { value: parameters.entityId } },
          { key: "content_field", match: { value: parameters.contentField } },
        ],
      },
    });
  }

  async getFieldProvenance(parameters: {
    projectId: string;
    entityType: string;
    entityId: string;
    contentField: string;
  }): Promise<FieldProvenance | null> {
    const { points } = await this.client.scroll(CONTENT_EMBEDDINGS_COLLECTION, {
      filter: {
        must: [
          { key: "project_id", match: { value: parameters.projectId } },
          { key: "entity_type", match: { value: parameters.entityType } },
          { key: "entity_id", match: { value: parameters.entityId } },
          { key: "content_field", match: { value: parameters.contentField } },
        ],
      },
      // Every chunk of this field from the same run carries identical
      // provenance (computed once per run, not per chunk) — one point is
      // enough to answer the §18 skip-decision question.
      limit: 1,
      with_payload: true,
      with_vector: false,
    });

    const point = points[0];

    if (!point) {
      return null;
    }

    const payload = point.payload as unknown as QdrantPointPayload;

    return {
      contentHash: payload.content_hash,
      icuVersion: payload.icu_version,
      chunkerSourceHash: payload.chunker_source_hash,
      embeddingProvider: payload.embedding_provider,
      embeddingModel: payload.embedding_model,
      embeddingVersion: payload.embedding_version,
    };
  }
}

// @qdrant/js-client-rest's own constructor defaults `timeout` to 300_000ms when
// the caller doesn't pass one (confirmed in dist/esm/qdrant-client.js: `timeout
// = 300000` in the destructured constructor params) — so a request was never
// actually unbounded, contrary to an earlier gate-review claim that omitting
// `timeout` here meant the AbortController/QdrantClientTimeoutError middleware
// never gets installed at all (dist/esm/api-client.js only skips it when
// `Number.isFinite(timeout)` is false, and 300_000 is finite). What omitting it
// DID mean: a merely-slow (not down) Qdrant would hold a prefetch slot — and
// the retry mechanism the classifier feeds (infrastructure/queue/consumer.ts)
// — for up to 5 minutes before QdrantClientTimeoutError even fires. Set
// explicitly to bound that to something proportionate to the consumer's own
// retryBaseDelayMs/backoff instead of inheriting the library's generic default.
const QDRANT_REQUEST_TIMEOUT_MS = 10_000;

export function createQdrantClient(): QdrantClient {
  const url = process.env.QDRANT_URL;

  if (!url) {
    throw new Error("Missing QDRANT_URL environment variable");
  }

  return new QdrantClient({ url, timeout: QDRANT_REQUEST_TIMEOUT_MS });
}

export function createQdrantVectorIndex({
  qdrantClient,
}: {
  qdrantClient: QdrantClient;
}): VectorIndex {
  return new QdrantVectorIndex(qdrantClient);
}
