import { describe, expect, it, vi } from "vitest";

import { isRetryableEmbeddingWorkerError } from "./isRetryableEmbeddingWorkerError.js";

import type { RabbitMqMessage } from "../queue/consumer.js";

// Verifies the WIRING this factory produces (queue/routing pattern, DLX naming, retry
// config, classifier reference, and message delegation) without a real RabbitMQ broker —
// the retry/DLX MECHANICS themselves are already proven for real against a live broker in
// consumer-retry-dlq.integration.test.ts. Also deliberately avoids starting a real consumer
// bound to the literal "embedding-worker" queue/"content.*" pattern here: that queue name is
// shared with whatever real worker process or other integration test (e.g.
// outbox-dispatcher.smoke.test.ts, which really does publish "content.created") might be
// running concurrently against the same broker — a real bind would risk cross-test
// contamination rather than proving anything this mock-based approach can't.
const createRabbitMqConsumerMock = vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() });

vi.mock("../queue/consumer.js", () => ({
  createRabbitMqConsumer: (...args: unknown[]) => createRabbitMqConsumerMock(...args) as unknown,
}));

const { createEmbeddingWorkerConsumer } = await import("./embeddingWorkerConsumer.js");

describe("createEmbeddingWorkerConsumer", () => {
  it("wires queue, routing pattern, DLX, retry attempts, and the embedding-worker error classifier", () => {
    const embeddingWorker = { handleContentEvent: vi.fn() };
    const rabbitmq = {} as never;

    createEmbeddingWorkerConsumer({ rabbitmq, embeddingWorker: embeddingWorker as never });

    expect(createRabbitMqConsumerMock).toHaveBeenCalledTimes(1);

    const [passedRabbitmq, options] = createRabbitMqConsumerMock.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];

    expect(passedRabbitmq).toBe(rabbitmq);
    expect(options.queue).toBe("embedding-worker");
    expect(options.routingKeyPattern).toBe("content.*");
    expect(options.deadLetterExchange).toBe("embedding-worker.dlx");
    expect(options.maxProcessingAttempts).toBe(3);
    expect(options.prefetch).toBe(4);
    expect(options.isRetryableError).toBe(isRetryableEmbeddingWorkerError);
    // No `exchange` override — see the module-level comment on why that matters.
    expect(options.exchange).toBeUndefined();
  });

  it("delegates handleMessage to embeddingWorker.handleContentEvent with the routingKey and payload", async () => {
    const embeddingWorker = { handleContentEvent: vi.fn().mockResolvedValue(undefined) };
    const rabbitmq = {} as never;

    createEmbeddingWorkerConsumer({ rabbitmq, embeddingWorker: embeddingWorker as never });

    const options = createRabbitMqConsumerMock.mock.calls.at(-1)?.[1] as {
      handleMessage: (message: RabbitMqMessage) => Promise<void>;
    };
    const payload = { projectId: "p1", entityType: "layer", entityId: "e1", revisionId: "r1", revisionNumber: 1, changedByUserId: "u1" };

    await options.handleMessage({ routingKey: "content.created", payload });

    expect(embeddingWorker.handleContentEvent).toHaveBeenCalledWith("content.created", payload);
  });
});
