import { beforeEach, describe, expect, it, vi } from "vitest";

const pipelineMock = vi.fn();

vi.mock("@huggingface/transformers", () => ({
  env: { cacheDir: null },
  pipeline: (...args: unknown[]) => pipelineMock(...args) as Promise<unknown>,
}));

const { LocalEmbeddingProvider } = await import("./LocalEmbeddingProvider.js");

describe("LocalEmbeddingProvider — extractor load failure recovery", () => {
  beforeEach(() => {
    pipelineMock.mockReset();
  });

  it("retries loading the extractor on the next call after a failed first attempt", async () => {
    const fakeExtractor = vi.fn(() => ({
      tolist: () => [[0.1, 0.2, 0.3]],
    }));

    pipelineMock
      .mockRejectedValueOnce(new Error("network drop mid-download"))
      .mockResolvedValueOnce(fakeExtractor);

    const provider = new LocalEmbeddingProvider();

    await expect(provider.embed("halo")).rejects.toThrow(
      "network drop mid-download",
    );

    // If the failed attempt were memoized permanently, this second call would reject
    // with the exact same cached error instead of calling pipeline() again.
    await expect(provider.embed("halo")).resolves.toMatchObject({
      vector: [0.1, 0.2, 0.3],
    });

    expect(pipelineMock).toHaveBeenCalledTimes(2);
  });

  it("does not re-attempt loading once the extractor has loaded successfully", async () => {
    const fakeExtractor = vi.fn(() => ({
      tolist: () => [[0.4, 0.5, 0.6]],
    }));

    pipelineMock.mockResolvedValue(fakeExtractor);

    const provider = new LocalEmbeddingProvider();

    await provider.embed("halo");
    await provider.embed("dunia");

    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });
});
