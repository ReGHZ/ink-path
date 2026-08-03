import { describe, expect, it, vi } from "vitest";

import { createRabbitMqConsumer } from "./consumer.js";

import type { RabbitMqManager } from "./rabbitmqManager.js";
import type { ConsumeMessage } from "amqplib";

// Reproduces a real race: amqplib's own delivery callback can still fire for a message
// that was already "in the pipe" even after stop() has closed and nulled our channel
// reference — closing a channel isn't synchronous with respect to already-dispatched
// deliveries. Found via outbox-worker-qdrant.end2end.test.ts's real teardown sequence
// intermittently logging an uncaught "RabbitMQ consumer channel not available" rejection
// during full-suite runs — this reproduces the exact same code path deterministically,
// with a stubbed transport instead of waiting for the real broker to hit the same timing.
function makeStubRabbitMqManager() {
  let deliver: ((message: ConsumeMessage) => void) | null = null;

  const fakeAmqpChannel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn(
      (
        _queue: string,
        callback: (message: ConsumeMessage) => void,
      ) => {
        deliver = callback;

        return Promise.resolve({ consumerTag: "stub-consumer-tag" });
      },
    ),
  };

  const rabbitMqChannel = {
    close: vi.fn().mockResolvedValue(undefined),
    isOpen: vi.fn().mockReturnValue(true),
    run: vi.fn((operation: (channel: typeof fakeAmqpChannel) => unknown) =>
      Promise.resolve(operation(fakeAmqpChannel)),
    ),
  };

  const rabbitmq = {
    createChannel: vi.fn(
      async (setup?: (channel: typeof fakeAmqpChannel) => Promise<void>) => {
        await setup?.(fakeAmqpChannel);

        return rabbitMqChannel;
      },
    ),
  } as unknown as RabbitMqManager;

  return {
    rabbitmq,
    deliverMessage: (message: ConsumeMessage) => deliver?.(message),
  };
}

function fakeMessage(routingKey: string, payload: unknown): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    fields: { routingKey } as ConsumeMessage["fields"],
    properties: {} as ConsumeMessage["properties"],
  };
}

describe("RabbitMqConsumer — post-shutdown delivery race", () => {
  it("does not crash with an unhandled rejection when a message is delivered after the channel was already closed", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const { rabbitmq, deliverMessage } = makeStubRabbitMqManager();
      const consumer = createRabbitMqConsumer(rabbitmq, {
        queue: "test-post-shutdown-race",
        routingKeyPattern: "test.*",
        handleMessage: () => Promise.resolve(),
      });

      await consumer.start();
      await consumer.stop();

      deliverMessage(fakeMessage("test.created", { hello: "world" }));

      // Let the fire-and-forget consumeMessage() promise chain actually settle before
      // asserting — an unhandled rejection surfaces on a later microtask/macrotask tick,
      // not synchronously at the point it's thrown.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toEqual([]);
  });
});
