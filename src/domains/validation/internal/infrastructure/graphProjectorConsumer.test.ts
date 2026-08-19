import { describe, expect, it, vi } from "vitest";

import { isRetryableGraphProjectorError } from "./isRetryableGraphProjectorError.js";
import { GRAPH_PROJECTOR_BINDINGS } from "../../../../shared/application/events/routingKeys.js";

import type { RabbitMqMessage } from "../../../../infrastructure/queue/consumer.js";
import type { GraphProjectorEventPayload } from "../application/GraphProjector.js";

// Verifies the WIRING this factory produces, which nothing else does: the e2e binds its
// own test-scoped queue (it has to — a topic exchange copies every matching message to
// every bound queue, so binding the production name would eat other tests' traffic), so
// without this file the production queue name, DLX, prefetch and classifier reference
// would be unverified. Same split, and same reason, as
// `embeddingWorkerConsumer.test.ts`; the retry/DLX MECHANICS are proven against a live
// broker in `consumer-retry-dlq.integration.test.ts`.
const createRabbitMqConsumerMock = vi
  .fn()
  .mockReturnValue({ start: vi.fn(), stop: vi.fn() });

vi.mock("../../../../infrastructure/queue/consumer.js", () => ({
  createRabbitMqConsumer: (...args: unknown[]) =>
    createRabbitMqConsumerMock(...args) as unknown,
}));

const loggerMock = { debug: vi.fn(), warn: vi.fn() };

vi.mock("../../../../infrastructure/logger.js", () => ({
  logger: loggerMock,
}));

const { createGraphProjectorConsumer } = await import(
  "./graphProjectorConsumer.js"
);

describe("createGraphProjectorConsumer", () => {
  it("binds BOTH projector patterns and wires queue, DLX, retries and classifier", () => {
    const graphProjector = { handleEvent: vi.fn() };

    createGraphProjectorConsumer({
      rabbitmq: {} as never,
      graphProjector: graphProjector as never,
    });

    const options = createRabbitMqConsumerMock.mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;

    // The two patterns, BY REFERENCE to the shared constant. Comparing to inline strings
    // here would let the factory and `routingKeys.ts` drift apart — which is the exact
    // failure gerbang G1's T-1 was about, where a published key matched no binding while
    // three documents claimed it did.
    expect(options.routingKeyPattern).toBe(GRAPH_PROJECTOR_BINDINGS);
    expect(options.queue).toBe("graph-projector");
    expect(options.deadLetterExchange).toBe("graph-projector.dlx");
    expect(options.maxProcessingAttempts).toBe(3);
    // Below the Prisma pool's default of 10, deliberately — see the constant's comment.
    expect(options.prefetch).toBe(8);
    // The domain-error classifier, not the embedding worker's vendor-shape one.
    expect(options.isRetryableError).toBe(isRetryableGraphProjectorError);
    // No `exchange` override: publisher and consumer must default to the same one, and
    // the `exchange` column stored on an outbox row is not what the publisher reads.
    expect(options.exchange).toBeUndefined();
  });

  it("hands the fold the routing key as delivered, not a narrowed one", async () => {
    const graphProjector = {
      handleEvent: vi.fn().mockResolvedValue({ kind: "folded" }),
    };

    createGraphProjectorConsumer({
      rabbitmq: {} as never,
      graphProjector: graphProjector as never,
    });

    const options = createRabbitMqConsumerMock.mock.calls.at(-1)?.[1] as {
      handleMessage: (
        message: RabbitMqMessage<GraphProjectorEventPayload>,
      ) => Promise<void>;
    };
    const payload = { projectId: "p1", assertionId: "a1" };

    await options.handleMessage({
      routingKey: "content.relationship.asserted",
      payload,
    });

    // The projector owns the "no fold for this key" decision and throws for it, which is
    // what dead-letters an unknown verb under either bound prefix. A cast to a union here
    // would turn that runtime decision into a silent one.
    expect(graphProjector.handleEvent).toHaveBeenCalledWith(
      "content.relationship.asserted",
      payload,
    );
  });
});

function handlerFor(outcome: unknown) {
  loggerMock.debug.mockClear();
  loggerMock.warn.mockClear();

  createGraphProjectorConsumer({
    rabbitmq: {} as never,
    graphProjector: {
      handleEvent: vi.fn().mockResolvedValue(outcome),
    } as never,
  });

  return createRabbitMqConsumerMock.mock.calls.at(-1)?.[1] as {
    handleMessage: (message: {
      routingKey: string;
      payload: unknown;
    }) => Promise<void>;
  };
}

describe("createGraphProjectorConsumer logging", () => {

  it("warns when an event changed nothing the graph needed", async () => {
    const handler = handlerFor({
      kind: "ignored",
      reason: "already_retracted_in_the_log",
    });

    await handler.handleMessage({
      routingKey: "content.relationship.asserted",
      payload: {},
    });

    // This log line is the ONLY production trace that ordering went sideways: the fold
    // refused a claim the log had already withdrawn. Everything else about that event looks
    // like a normal, successful delivery.
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.debug).not.toHaveBeenCalled();
  });

  it("warns when a retraction removed nothing", async () => {
    const handler = handlerFor({
      kind: "unfolded",
      sourceAssertionId: "a1",
      edgesRemoved: 0,
    });

    await handler.handleMessage({
      routingKey: "content.relationship.retracted",
      payload: {},
    });

    // Zero removed is a documented NORMAL answer (a retraction aimed at a `terminate`, or a
    // redelivery) — so it cannot be an error, and it must not be silence either.
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn on an ordinary fold", async () => {
    const handler = handlerFor({ kind: "folded", sourceAssertionId: "a1" });

    await handler.handleMessage({
      routingKey: "content.relationship.asserted",
      payload: {},
    });

    // The warn level has to stay meaningful, or it stops being read at all.
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.debug).toHaveBeenCalledTimes(1);
  });
});
