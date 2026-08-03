import { describe, expect, it } from "vitest";

import { buildPointKey, derivePointId } from "./pointId.js";
import { buildQdrantPoint, type BuildQdrantPointInput } from "./qdrantPayload.js";

const BASE_INPUT: BuildQdrantPointInput = {
  projectId: "11111111-1111-1111-1111-111111111111",
  entityType: "layer",
  entityId: "22222222-2222-2222-2222-222222222222",
  contentField: "description",
  revisionId: "33333333-3333-3333-3333-333333333333",
  chunkIndex: 0,
  revisionNumber: 3,
  chunkCount: 2,
  contentHash: "a".repeat(64),
  embeddingProvider: "local",
  embeddingModel: "paraphrase-multilingual-mpnet-base-v2",
  embeddingVersion: "1",
  icuVersion: "78.3",
  chunkerSourceHash: "b".repeat(64),
  now: new Date("2026-07-29T10:00:00.000Z"),
};

describe("buildQdrantPoint", () => {
  it("derives the same id as calling buildPointKey/derivePointId directly", () => {
    const point = buildQdrantPoint(BASE_INPUT);
    const expectedId = derivePointId(buildPointKey(BASE_INPUT));

    expect(point.id).toBe(expectedId);
  });

  it("stores embedding_provider and embedding_model as separate fields", () => {
    const point = buildQdrantPoint(BASE_INPUT);

    expect(point.payload.embedding_provider).toBe("local");
    expect(point.payload.embedding_model).toBe(
      "paraphrase-multilingual-mpnet-base-v2",
    );
  });

  it("always sets is_current to true (Phase 1 current-only indexing)", () => {
    expect(buildQdrantPoint(BASE_INPUT).payload.is_current).toBe(true);
  });

  it("stores created_at as an ISO-8601 string derived from the given clock", () => {
    expect(buildQdrantPoint(BASE_INPUT).payload.created_at).toBe(
      "2026-07-29T10:00:00.000Z",
    );
  });

  it("stores the canonical point_key for debugging", () => {
    const point = buildQdrantPoint(BASE_INPUT);

    expect(point.payload.point_key).toBe(buildPointKey(BASE_INPUT));
  });

  it("omits content_text_preview when not provided", () => {
    const point = buildQdrantPoint(BASE_INPUT);

    expect(point.payload).not.toHaveProperty("content_text_preview");
  });

  it("includes content_text_preview when provided", () => {
    const point = buildQdrantPoint({
      ...BASE_INPUT,
      contentTextPreview: "A short preview...",
    });

    expect(point.payload.content_text_preview).toBe("A short preview...");
  });

  it("carries chunk_count through as given — one field's own chunk count, not an entity-wide total", () => {
    const point = buildQdrantPoint({ ...BASE_INPUT, chunkCount: 5 });

    expect(point.payload.chunk_count).toBe(5);
  });

  it("stores icu_version and chunker_source_hash as separate provenance fields (addendum 2026-07-30)", () => {
    const point = buildQdrantPoint(BASE_INPUT);

    expect(point.payload.icu_version).toBe("78.3");
    expect(point.payload.chunker_source_hash).toBe("b".repeat(64));
  });
});
