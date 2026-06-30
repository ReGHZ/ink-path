import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppContainer } from "../../src/infrastructure/container.js";
import { OutboxDispatcher } from "../../src/infrastructure/outbox/outboxDispatcher.js";
import { createSampleConsumer } from "../../src/infrastructure/queue/sampleConsumer.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { OutboxRepository } from "../../src/infrastructure/outbox/outboxRepository.js";
import type { RabbitMqMessage, RabbitMqConsumer } from "../../src/infrastructure/queue/consumer.js";
import type { RabbitMqPublisher } from "../../src/infrastructure/queue/publisher.js";
import type { RabbitMqManager } from "../../src/infrastructure/queue/rabbitmqManager.js";

const ROUTING_KEY = "content.created";
const EXCHANGE = "ink-path.events";

let prisma: PrismaClient;
let rabbitmq: RabbitMqManager;
let outboxRepository: OutboxRepository;
let publisher: RabbitMqPublisher;
let consumer: RabbitMqConsumer;

const received: RabbitMqMessage[] = [];

async function cleanOutbox(client: PrismaClient): Promise<void> {
  await client.deadLetterEvent.deleteMany({});
  await client.outboxEvent.deleteMany({});
}

async function seedOutboxEvent(overrides: { maxRetries?: number } = {}): Promise<{ id: string }> {
  return prisma.outboxEvent.create({
    data: {
      eventType: "content.created",
      eventVersion: 1,
      aggregateType: "content",
      aggregateId: crypto.randomUUID(),
      payload: { test: true },
      status: "pending",
      routingKey: ROUTING_KEY,
      exchange: EXCHANGE,
      retryCount: 0,
      maxRetries: overrides.maxRetries ?? 3,
    },
    select: { id: true },
  });
}

function makeFailingPublisher(): RabbitMqPublisher {
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    publish: (): Promise<boolean> => {
      throw new Error("simulated publish failure");
    },
  } as unknown as RabbitMqPublisher;
}

describe("outbox dispatcher smoke", () => {
  beforeAll(async () => {
    const container = createAppContainer();
    prisma = container.resolve("prisma");
    rabbitmq = container.resolve("rabbitmq");
    outboxRepository = container.resolve("outboxRepository");
    publisher = container.resolve("rabbitMqPublisher");

    await rabbitmq.start();

    consumer = createSampleConsumer({
      rabbitmq,
      onMessage: (message) => {
        received.push(message);
      },
    });

    await consumer.start();
  });

  beforeEach(async () => {
    await cleanOutbox(prisma);
    received.length = 0;
  });

  afterAll(async () => {
    await consumer.stop();
    await rabbitmq.stop();
    await prisma.$disconnect();
  });

  it("happy path: publishes outbox event and consumer receives it", async () => {
    const { id } = await seedOutboxEvent();

    const dispatcher = new OutboxDispatcher(outboxRepository, publisher, {
      workerId: "smoke-happy-worker",
      pollIntervalMs: 100,
    });

    await dispatcher.start();

    try {
      await expect.poll(() => received.length, { timeout: 10_000 }).toBe(1);
      expect(received[0].routingKey).toBe(ROUTING_KEY);

      await dispatcher.stop();

      const row = await prisma.outboxEvent.findUnique({ where: { id } });
      expect(row?.status).toBe("published");
      expect(row?.publishedAt).not.toBeNull();
      expect(row?.lockedAt).toBeNull();
      expect(row?.lockedBy).toBeNull();
      expect(row?.lastErrorCode).toBeNull();
    } finally {
      await dispatcher.stop();
    }
  });

  it("retry path: failed publish increments retry_count and sets next_retry_at", async () => {
    const { id } = await seedOutboxEvent({ maxRetries: 3 });

    const dispatcher = new OutboxDispatcher(outboxRepository, makeFailingPublisher(), {
      workerId: "smoke-retry-worker",
      pollIntervalMs: 100,
      retryBaseDelayMs: 30_000,
    });

    await dispatcher.start();

    try {
      await expect.poll(
        async () => {
          const row = await prisma.outboxEvent.findUnique({ where: { id } });
          return row?.status === "failed";
        },
        { timeout: 10_000 },
      ).toBe(true);

      await dispatcher.stop();

      const row = await prisma.outboxEvent.findUnique({ where: { id } });
      expect(row?.status).toBe("failed");
      expect(row?.retryCount).toBe(1);
      expect(row?.nextRetryAt).not.toBeNull();
    } finally {
      await dispatcher.stop();
    }
  });

  it("dead-letter path: exhausted event is dead_lettered with retry_count == maxRetries", async () => {
    const { id } = await seedOutboxEvent({ maxRetries: 2 });

    const dispatcher = new OutboxDispatcher(outboxRepository, makeFailingPublisher(), {
      workerId: "smoke-dlq-worker",
      pollIntervalMs: 100,
      retryBaseDelayMs: 50,
    });

    await dispatcher.start();

    try {
      await expect.poll(
        async () => {
          const row = await prisma.outboxEvent.findUnique({ where: { id } });
          return row?.status;
        },
        { timeout: 10_000 },
      ).toBe("dead_lettered");

      await dispatcher.stop();

      const row = await prisma.outboxEvent.findUnique({
        where: { id },
        select: {
          status: true,
          retryCount: true,
          maxRetries: true,
          lockedAt: true,
          lockedBy: true,
          lastErrorCode: true,
          lastErrorMessage: true,
        },
      });
      expect(row?.status).toBe("dead_lettered");
      expect(row?.retryCount).toBe(row?.maxRetries);
      expect(row?.lockedAt).toBeNull();
      expect(row?.lockedBy).toBeNull();
      expect(row?.lastErrorCode).toBe("OUTBOX_PUBLISH_FAILED");
      expect(row?.lastErrorMessage).toBe("simulated publish failure");

      const dlRow = await prisma.deadLetterEvent.findFirst({ where: { outboxEventId: id } });
      expect(dlRow).not.toBeNull();
      expect(dlRow?.retryCount).toBe(row?.maxRetries);
      expect(dlRow?.failureSource).toBe("outbox_publish");
      expect(dlRow?.rootOutboxEventId).toBe(id);
    } finally {
      await dispatcher.stop();
    }
  });
});
