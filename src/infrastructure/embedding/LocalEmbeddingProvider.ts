import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

import type {
  EmbeddingProvider,
  EmbeddingResult,
} from "../../shared/application/ports/EmbeddingProvider.js";

const MODEL_NAME = "Xenova/paraphrase-multilingual-mpnet-base-v2";
const DIMENSION = 768;

// `/workspace` is bind-mounted to the host repo (.devcontainer/docker-compose.yml), unlike
// `node_modules`, which is a Docker-managed volume invisible on the host. Caching here
// instead of the library's default (node_modules/@huggingface/transformers/.cache/) lets
// the downloaded model weights be copied between machines as a plain folder instead of
// re-downloaded on each one — see notes/phase-5-embedding-worker-qdrant.md. Already covered
// by the existing `.cache/` gitignore rule.
env.cacheDir = "./.cache/transformers-models";

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "local";
  readonly model = MODEL_NAME;
  readonly dimension = DIMENSION;

  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  // On failure, the rejected promise is deliberately NOT left memoized — this project has
  // no process-level restart policy anywhere (every service in docker-compose.yml is
  // `restart: "no"`), so caching a permanent rejection here would mean one transient
  // failure (network drop mid-download, etc.) wedges this instance until a human notices
  // and restarts it manually. Clearing on failure lets the next call retry fresh; once the
  // embedding worker (5.2) exists, repeated failures are naturally bounded by the embedding
  // worker's own Consumer-level retry/backoff/dead-letter (RabbitMqConsumer's
  // isRetryableError/maxProcessingAttempts — this is a message CONSUMER, not the outbox
  // dispatcher, so the bounding mechanism lives on the consume side), not by this class.
  private getExtractor(): Promise<FeatureExtractionPipeline> {
    this.extractorPromise ??= pipeline("feature-extraction", MODEL_NAME, {
      dtype: "q8",
    }).catch((error: unknown) => {
      this.extractorPromise = null;
      throw error;
    });

    return this.extractorPromise;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedVectors([text]);
    const result = results[0];

    if (!result) {
      throw new Error("Embedding provider returned no result for a single input");
    }

    return result;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return this.embedVectors(texts);
  }

  // A single batched call, not a loop over embed() — the pipeline accepts string[]
  // directly and handles padding/batching internally, which is both faster and the
  // documented usage (feature-extraction.d.ts) for multiple inputs.
  private async embedVectors(texts: string[]): Promise<EmbeddingResult[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(texts, {
      pooling: "mean",
      normalize: true,
    });
    const vectors = output.tolist() as number[][];

    return vectors.map((vector) => ({
      vector,
      model: this.model,
      dimension: this.dimension,
    }));
  }
}

export function createLocalEmbeddingProvider(): EmbeddingProvider {
  return new LocalEmbeddingProvider();
}
