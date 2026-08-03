import type { TokenCounter } from "../../embedding/chunker.js";

export type EmbeddingResult = {
  vector: number[];
  model: string;
  dimension: number;
};

export type EmbeddingProvider = {
  readonly providerName: string;
  readonly model: string;
  readonly dimension: number;
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  // chunker.ts's TokenCounter is synchronous by design (called many times per
  // field during paragraph/sentence-boundary packing) — but the tokenizer
  // backing it may need async loading first (e.g. LocalEmbeddingProvider's
  // lazily-loaded @huggingface/transformers pipeline). This method is the one
  // async step: await it ONCE (per worker run is enough — the tokenizer
  // doesn't change mid-process), then hand the returned sync function
  // straight to chunkText(). Tied to the same underlying model as
  // embed()/embedBatch(), so a tokenizer change always comes with an
  // `embedding_model` change too — §18's skip-decision already covers that
  // drift via `embedding_model`, so chunker_source_hash doesn't need to
  // separately represent tokenizer identity.
  getTokenCounter(): Promise<TokenCounter>;
};
