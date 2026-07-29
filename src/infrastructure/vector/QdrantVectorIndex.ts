import { QdrantClient } from "@qdrant/js-client-rest";

import type {
  VectorIndex,
  VectorIndexPoint,
} from "../../shared/application/ports/VectorIndex.js";

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
}

export function createQdrantClient(): QdrantClient {
  const url = process.env.QDRANT_URL;

  if (!url) {
    throw new Error("Missing QDRANT_URL environment variable");
  }

  return new QdrantClient({ url });
}

export function createQdrantVectorIndex({
  qdrantClient,
}: {
  qdrantClient: QdrantClient;
}): VectorIndex {
  return new QdrantVectorIndex(qdrantClient);
}
