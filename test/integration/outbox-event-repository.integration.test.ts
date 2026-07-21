import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";
import { PrismaOutboxEventRepository } from "../../src/shared/infrastructure/PrismaOutboxEventRepository.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { OutboxEvent } from "../../src/shared/application/ports/OutboxEventRepository.js";

const now = new Date("2026-07-20T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001001";
const projectId = "00000000-0000-4000-8000-000000001002";

const outboxEventIds = [
  "11111111-0000-4000-8000-000000000001",
  "11111111-0000-4000-8000-000000000002",
];

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaOutboxEventRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerAndProject(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "outbox-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Outbox test project",
    now,
  });
  await projects.insert(project);
}

function buildEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: outboxEventIds[0],
    eventType: "content.created",
    eventVersion: 1,
    aggregateType: "world_element",
    aggregateId: "22222222-0000-4000-8000-000000000001",
    projectId,
    triggeredByUserId: ownerUserId,
    payload: {
      projectId,
      entityType: "world_element",
      entityId: "22222222-0000-4000-8000-000000000001",
      revisionId: "33333333-0000-4000-8000-000000000001",
      revisionNumber: 0,
      changedByUserId: ownerUserId,
    },
    routingKey: "content.created",
    exchange: "saas.events",
    ...overrides,
  };
}

describe("PrismaOutboxEventRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerAndProject();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts an outbox event with all producer-owned fields persisted", async () => {
    const event = buildEvent();

    await repository.insert(event);

    const row = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });

    expect(row.eventType).toBe("content.created");
    expect(row.eventVersion).toBe(1);
    expect(row.aggregateType).toBe("world_element");
    expect(row.aggregateId).toBe(event.aggregateId);
    expect(row.projectId).toBe(projectId);
    expect(row.triggeredByUserId).toBe(ownerUserId);
    expect(row.payload).toEqual(event.payload);
    expect(row.routingKey).toBe("content.created");
    expect(row.exchange).toBe("saas.events");
  });

  it("defaults dispatcher-owned fields to a fresh pending event", async () => {
    const event = buildEvent();

    await repository.insert(event);

    const row = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });

    expect(row.status).toBe("pending");
    expect(row.retryCount).toBe(0);
    expect(row.publishedAt).toBeNull();
    expect(row.lockedAt).toBeNull();
  });

  it("accepts null projectId and triggeredByUserId for non-project-scoped events", async () => {
    const event = buildEvent({ projectId: null, triggeredByUserId: null });

    await repository.insert(event);

    const row = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });

    expect(row.projectId).toBeNull();
    expect(row.triggeredByUserId).toBeNull();
  });

  // The whole point of this port (03-database-design/12_outbox_event_persistence.md
  // "Transaction Boundary": outbox row harus dibuat dalam transaction yang
  // sama dengan domain write) is that a repository instance built from a
  // transaction's `tx` client commits and rolls back together with every
  // other write in that same transaction — not on a separate connection.
  it("rolls back together with the transaction when it fails", async () => {
    const event = buildEvent();
    const expectedError = new Error("force rollback");

    await expect(
      prisma.$transaction(async (tx) => {
        const txRepository = new PrismaOutboxEventRepository(tx);
        await txRepository.insert(event);
        throw expectedError;
      }),
    ).rejects.toBe(expectedError);

    await expect(
      prisma.outboxEvent.findUnique({ where: { id: event.id } }),
    ).resolves.toBeNull();
  });

  it("commits together with the transaction when it succeeds", async () => {
    const event = buildEvent();

    await prisma.$transaction(async (tx) => {
      const txRepository = new PrismaOutboxEventRepository(tx);
      await txRepository.insert(event);
    });

    await expect(
      prisma.outboxEvent.findUnique({ where: { id: event.id } }),
    ).resolves.not.toBeNull();
  });
});
