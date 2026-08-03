import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAppContainer } from "../../src/infrastructure/container.js";
import { OutboxStaleLockRecoveryJob } from "../../src/infrastructure/outbox/outboxStaleLockRecoveryJob.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { OutboxRepository } from "../../src/infrastructure/outbox/outboxRepository.js";

// 05-implementation-policy/04_stale_worker_recovery.md §2/§15 — heals outbox_events rows
// left stuck in `processing` by a dispatcher that died before releasing its lock.
// Real Postgres, no mocking — same convention as outbox-dispatcher.smoke.test.ts (the thing
// under test IS the SQL/locking behavior, a stub repository wouldn't prove anything).
//
// Deliberately does NOT wipe outbox_events wholesale the way outbox-dispatcher.smoke.test.ts
// does (blanket `outboxEvent.deleteMany({})`) — outbox-worker-qdrant.end2end.test.ts runs a
// REAL dispatcher against this same shared table concurrently, and a blanket wipe here
// deletes its in-flight row out from under it (confirmed: this exact change caused that
// test to time out at 60s until traced back here). Each test below creates its own
// uniquely-`aggregateId`'d row and asserts on THAT row specifically by id — cleans up only
// what it created, never touches anyone else's rows, and never asserts on aggregate
// recoverStaleLocks() counts (another concurrent test's genuinely 5+-minute-stale row is
// unlikely but not impossible, and the per-row assertions already prove everything that
// matters without needing exclusive access to the table).
let prisma: PrismaClient;
let outboxRepository: OutboxRepository;
const createdIds: string[] = [];

async function seedProcessingEvent(overrides: {
  lockedAt: Date;
  retryCount?: number;
  maxRetries?: number;
}): Promise<{ id: string }> {
  const { id } = await prisma.outboxEvent.create({
    data: {
      eventType: "content.created",
      eventVersion: 1,
      aggregateType: "content",
      aggregateId: crypto.randomUUID(),
      payload: { test: true },
      status: "processing",
      routingKey: "content.created",
      exchange: "ink-path.events",
      retryCount: overrides.retryCount ?? 0,
      maxRetries: overrides.maxRetries ?? 3,
      lockedAt: overrides.lockedAt,
      lockedBy: "a-worker-that-no-longer-exists",
    },
    select: { id: true },
  });

  createdIds.push(id);

  return { id };
}

describe("OutboxRepository.recoverStaleLocks", () => {
  beforeAll(() => {
    const container = createAppContainer();
    prisma = container.resolve("prisma");
    outboxRepository = container.resolve("outboxRepository");
  });

  afterAll(async () => {
    await prisma.deadLetterEvent.deleteMany({ where: { outboxEventId: { in: createdIds } } });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it("recovers a stale processing row with retries left back to failed, without incrementing retry_count", async () => {
    const staleLockedAt = new Date(Date.now() - 10 * 60_000);
    const { id } = await seedProcessingEvent({ lockedAt: staleLockedAt, retryCount: 1, maxRetries: 3 });

    await outboxRepository.recoverStaleLocks(new Date(Date.now() - 5 * 60_000), 10);

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

    expect(row.status).toBe("failed");
    expect(row.retryCount).toBe(1);
    expect(row.lockedAt).toBeNull();
    expect(row.lockedBy).toBeNull();
    expect(row.lastErrorCode).toBe("STALE_OUTBOX_LOCK");
    expect(row.nextRetryAt).not.toBeNull();
  });

  it("moves a stale processing row with retries exhausted to dead_lettered and inserts a dead_letter_events row", async () => {
    const staleLockedAt = new Date(Date.now() - 10 * 60_000);
    const { id } = await seedProcessingEvent({ lockedAt: staleLockedAt, retryCount: 3, maxRetries: 3 });

    await outboxRepository.recoverStaleLocks(new Date(Date.now() - 5 * 60_000), 10);

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

    expect(row.status).toBe("dead_lettered");
    expect(row.lockedAt).toBeNull();
    expect(row.lockedBy).toBeNull();

    const deadLetter = await prisma.deadLetterEvent.findFirstOrThrow({
      where: { outboxEventId: id },
    });

    expect(deadLetter.failureSource).toBe("outbox_publish");
    expect(deadLetter.lastErrorCode).toBe("STALE_OUTBOX_LOCK");
  });

  it("does not touch a processing row whose lock is not yet stale", async () => {
    const recentLockedAt = new Date(Date.now() - 30_000);
    const { id } = await seedProcessingEvent({ lockedAt: recentLockedAt });

    await outboxRepository.recoverStaleLocks(new Date(Date.now() - 5 * 60_000), 10);

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

    expect(row.status).toBe("processing");
  });

  it("does not touch pending/failed/published rows, only processing", async () => {
    const { id } = await prisma.outboxEvent.create({
      data: {
        eventType: "content.created",
        eventVersion: 1,
        aggregateType: "content",
        aggregateId: crypto.randomUUID(),
        payload: { test: true },
        status: "pending",
        routingKey: "content.created",
        exchange: "ink-path.events",
      },
      select: { id: true },
    });

    createdIds.push(id);

    await outboxRepository.recoverStaleLocks(new Date(Date.now() - 5 * 60_000), 10);

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

    expect(row.status).toBe("pending");
  });
});

describe("OutboxStaleLockRecoveryJob", () => {
  beforeAll(() => {
    const container = createAppContainer();
    prisma = container.resolve("prisma");
    outboxRepository = container.resolve("outboxRepository");
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it("periodically recovers stale locks on its own schedule", async () => {
    const staleLockedAt = new Date(Date.now() - 10 * 60_000);
    const { id } = await seedProcessingEvent({ lockedAt: staleLockedAt });

    const job = new OutboxStaleLockRecoveryJob(outboxRepository, {
      pollIntervalMs: 100,
      staleThresholdMs: 5 * 60_000,
      batchSize: 10,
    });

    await job.start();

    try {
      await expect
        .poll(
          async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).status,
          { timeout: 5_000 },
        )
        .toBe("failed");
    } finally {
      await job.stop();
    }
  });
});
