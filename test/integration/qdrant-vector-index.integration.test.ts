import { randomUUID } from "node:crypto";

import { QdrantClient } from "@qdrant/js-client-rest";
import { describe, expect, it } from "vitest";

import {
  CONTENT_EMBEDDINGS_COLLECTION,
  QdrantVectorIndex,
} from "../../src/infrastructure/vector/QdrantVectorIndex.js";

import type { VectorIndexPoint } from "../../src/shared/application/ports/VectorIndex.js";

// Hits the real Qdrant instance already running in this devcontainer (QDRANT_URL,
// see docker-compose.yml) — there is no ephemeral testcontainer for Qdrant the way
// globalSetup.ts spins one up for Postgres/RabbitMQ, so `content_embeddings` and its
// test points persist in the shared dev instance across runs. Each test uses a fresh
// random project/entity id to stay isolated from every other test and run.
const client = new QdrantClient({ url: process.env.QDRANT_URL });
const vectorIndex = new QdrantVectorIndex(client);

function samplePoint(overrides: Partial<VectorIndexPoint["payload"]> = {}): VectorIndexPoint {
  const projectId = overrides.project_id ?? randomUUID();
  const entityId = overrides.entity_id ?? randomUUID();

  return {
    id: randomUUID(),
    vector: Array.from({ length: 768 }, () => Math.random()),
    payload: {
      project_id: projectId,
      entity_type: "layer",
      entity_id: entityId,
      content_field: "description",
      revision_id: randomUUID(),
      revision_number: 1,
      chunk_index: 0,
      chunk_count: 1,
      is_current: true,
      content_hash: "a".repeat(64),
      embedding_provider: "local",
      embedding_model: "paraphrase-multilingual-mpnet-base-v2",
      embedding_version: "1",
      point_key: `${projectId}:layer:${entityId}:description:${randomUUID()}:0`,
      created_at: new Date().toISOString(),
      ...overrides,
    },
  };
}

describe("QdrantVectorIndex", () => {
  it("creates the collection with vector_size 768 and Cosine distance", async () => {
    await vectorIndex.ensureCollection();

    const info = await client.getCollection(CONTENT_EMBEDDINGS_COLLECTION);
    const vectorsConfig = info.config.params.vectors;

    expect(vectorsConfig).toMatchObject({ size: 768, distance: "Cosine" });
  });

  it("is idempotent — calling ensureCollection twice does not throw", async () => {
    await vectorIndex.ensureCollection();

    await expect(vectorIndex.ensureCollection()).resolves.not.toThrow();
  });

  it("creates payload indexes for project_id, entity_id, is_current, entity_type, content_field", async () => {
    await vectorIndex.ensureCollection();

    const info = await client.getCollection(CONTENT_EMBEDDINGS_COLLECTION);
    const indexedFields = Object.keys(info.payload_schema);

    for (const field of [
      "project_id",
      "entity_id",
      "is_current",
      "entity_type",
      "content_field",
    ]) {
      expect(indexedFields).toContain(field);
    }
  });

  it("upserts a point and retrieves it back with the same vector and payload", async () => {
    await vectorIndex.ensureCollection();

    const point = samplePoint();

    await vectorIndex.upsertPoints([point]);

    const [retrieved] = await client.retrieve(CONTENT_EMBEDDINGS_COLLECTION, {
      ids: [point.id],
      with_payload: true,
      with_vector: true,
    });

    expect(retrieved?.payload).toMatchObject({
      project_id: point.payload.project_id,
      entity_id: point.payload.entity_id,
      embedding_provider: "local",
    });
    expect(retrieved?.vector).toHaveLength(768);
  });

  it("deletes only the points belonging to the targeted entity", async () => {
    await vectorIndex.ensureCollection();

    const projectId = randomUUID();
    const targetEntityId = randomUUID();
    const otherEntityId = randomUUID();

    const targetChunkA = samplePoint({
      project_id: projectId,
      entity_id: targetEntityId,
      content_field: "description",
    });
    const targetChunkB = samplePoint({
      project_id: projectId,
      entity_id: targetEntityId,
      content_field: "content",
    });
    const otherPoint = samplePoint({
      project_id: projectId,
      entity_id: otherEntityId,
    });

    await vectorIndex.upsertPoints([targetChunkA, targetChunkB, otherPoint]);

    await vectorIndex.deletePointsForEntity({
      projectId,
      entityType: "layer",
      entityId: targetEntityId,
    });

    const remaining = await client.retrieve(CONTENT_EMBEDDINGS_COLLECTION, {
      ids: [targetChunkA.id, targetChunkB.id, otherPoint.id],
    });

    expect(remaining.map((r) => r.id)).toEqual([otherPoint.id]);
  });
});
