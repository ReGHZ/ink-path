import { describe, expect, it } from "vitest";

import { LocalEmbeddingProvider } from "../../src/infrastructure/embedding/LocalEmbeddingProvider.js";

// Real model download + real CPU inference — no mocking. First run downloads
// Xenova/paraphrase-multilingual-mpnet-base-v2 (quantized) into
// ink-path/.cache/transformers-models/ (see LocalEmbeddingProvider.ts), which is
// exactly the folder meant to be copied between machines (notes/
// phase-5-embedding-worker-qdrant.md). Generous timeout for the first-run download.
const MODEL_DOWNLOAD_TIMEOUT_MS = 180_000;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [index, valueA] of a.entries()) {
    const valueB = b[index] ?? 0;

    dot += valueA * valueB;
    normA += valueA ** 2;
    normB += valueB ** 2;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe("LocalEmbeddingProvider", () => {
  it(
    "reports itself as the local provider at 768 dimensions",
    () => {
      const provider = new LocalEmbeddingProvider();

      expect(provider.providerName).toBe("local");
      expect(provider.dimension).toBe(768);
      expect(provider.model).toBe("Xenova/paraphrase-multilingual-mpnet-base-v2");
    },
  );

  it(
    "embeds a single text into a 768-dimensional, ~unit-length vector",
    async () => {
      const provider = new LocalEmbeddingProvider();
      const result = await provider.embed("Seekor naga tidur di dalam gua.");

      expect(result.vector).toHaveLength(768);
      expect(result.dimension).toBe(768);
      expect(result.model).toBe("Xenova/paraphrase-multilingual-mpnet-base-v2");

      const norm = Math.sqrt(result.vector.reduce((sum, x) => sum + x * x, 0));

      expect(norm).toBeGreaterThan(0.99);
      expect(norm).toBeLessThan(1.01);
    },
    MODEL_DOWNLOAD_TIMEOUT_MS,
  );

  it(
    "embeds a batch in one call, returning one vector per input in order",
    async () => {
      const provider = new LocalEmbeddingProvider();
      const results = await provider.embedBatch([
        "Naga itu tertidur di dalam gua.",
        "Resep membuat kue coklat.",
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]?.vector).toHaveLength(768);
      expect(results[1]?.vector).toHaveLength(768);
    },
    MODEL_DOWNLOAD_TIMEOUT_MS,
  );

  it(
    "gives semantically similar Indonesian sentences a higher cosine similarity than unrelated ones",
    async () => {
      const provider = new LocalEmbeddingProvider();
      const embeddings = await provider.embedBatch([
        "Seekor naga tidur di dalam gua.",
        "Naga itu tertidur di dalam gua.",
        "Resep membuat kue coklat.",
      ]);
      const [dragonA, dragonB, unrelated] = embeddings;

      if (!dragonA || !dragonB || !unrelated) {
        throw new Error("expected three embeddings back from embedBatch");
      }

      const similarPairScore = cosineSimilarity(dragonA.vector, dragonB.vector);
      const unrelatedPairScore = cosineSimilarity(dragonA.vector, unrelated.vector);

      expect(similarPairScore).toBeGreaterThan(unrelatedPairScore);
      expect(similarPairScore).toBeGreaterThan(0.8);
    },
    MODEL_DOWNLOAD_TIMEOUT_MS,
  );
});
