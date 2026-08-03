import { describe, expect, it } from "vitest";

import { createAppContainer } from "../../src/infrastructure/container.js";

// Wiring test, not a behavior test — EmbeddingWorker.test.ts already covers the
// orchestration logic via hand-written stubs, and the underlying ports
// (VectorIndex, ContentEntityReader, Consumer/RabbitMqConsumer) already have their
// own real-infra integration tests. What this proves instead: every new
// container.ts registration for 5.2c-iii (embeddingProvider, aiUsageLogWriter,
// embeddingWorker, embeddingWorkerConsumer) actually resolves from the real Awilix
// container — nothing type-checks that a factory's destructured parameter names
// genuinely match AppCradle's keys, only resolving at runtime does (same
// reasoning as content-entity-reader.integration.test.ts).
describe("5.2c-iii container wiring", () => {
  it("resolves embeddingProvider, aiUsageLogWriter, embeddingWorker, and embeddingWorkerConsumer without a wiring error", () => {
    const container = createAppContainer();

    const embeddingProvider = container.resolve("embeddingProvider");
    const aiUsageLogWriter = container.resolve("aiUsageLogWriter");
    const embeddingWorker = container.resolve("embeddingWorker");
    const embeddingWorkerConsumer = container.resolve("embeddingWorkerConsumer");

    expect(embeddingProvider.providerName).toBe("local");
    expect(typeof aiUsageLogWriter.begin).toBe("function");
    expect(typeof embeddingWorker.handleContentEvent).toBe("function");
    expect(typeof embeddingWorkerConsumer.start).toBe("function");
    expect(typeof embeddingWorkerConsumer.stop).toBe("function");
  });
});
