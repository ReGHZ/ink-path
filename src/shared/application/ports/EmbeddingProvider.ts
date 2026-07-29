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
};
