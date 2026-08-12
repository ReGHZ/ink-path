import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Event } from "../../src/domains/content/internal/domain/world/Event.js";
import {
  EventRepositoryConflictError,
  EventRepositoryNotFoundError,
} from "../../src/domains/content/internal/domain/world/EventRepositoryError.js";
import { PrismaEventRepository } from "../../src/domains/content/internal/infrastructure/world/PrismaEventRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-08-12T00:00:00.000Z");
const later = new Date("2026-08-12T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001101";
const projectId = "00000000-0000-4000-8000-000000001102";
const revisionId = "00000000-0000-4000-8000-000000001103";

const eventIds = [
  "61616161-0000-4000-8000-000000000001",
  "61616161-0000-4000-8000-000000000002",
];

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaEventRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectAndRevision(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "event-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Nine Heavens Qi Chronicle",
    now,
  });
  await projects.insert(project);

  // Same fixture shape as the Phase 4 repository tests: no Domain/repository
  // exists for ContentRevision, and `entityId` is a plain UUID column with no
  // FK, so the row is seeded straight through Prisma.
  await prisma.contentRevision.create({
    data: {
      id: revisionId,
      projectId,
      entityType: "event",
      entityId: eventIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      afterSnapshot: {},
    },
  });
}

function createEvent(
  id: string,
  title: string,
  overrides: { timelineOrder?: number | null; content?: string | null } = {},
): Event {
  return Event.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    title,
    era: "Era of the Sundered Meridian",
    timelineOrder: overrides.timelineOrder ?? null,
    eventType: "cataclysm",
    significance: "world_shaking",
    content: overrides.content ?? null,
    currentRevisionId: revisionId,
    now,
  });
}

// insert() always writes a null currentRevisionId (the FK is not DEFERRABLE),
// so tests that need a fully created row patch it directly rather than going
// through the version-guarded update(). Mirrors insertLayer() in the Phase 4
// suite.
async function insertEvent(event: Event): Promise<void> {
  await repository.insert(event);
  await prisma.event.update({
    where: { id: event.id },
    data: { currentRevisionId: revisionId },
  });
}

describe("PrismaEventRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectAndRevision();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds an event by id", async () => {
    const event = createEvent(eventIds[0], "Collapse of the Northern Qi Spire");

    await insertEvent(event);

    const found = await repository.findById(event.id);

    expect(found?.id).toBe(event.id);
    expect(found?.title).toBe("Collapse of the Northern Qi Spire");
    expect(found?.projectId).toBe(projectId);
    expect(found?.era).toBe("Era of the Sundered Meridian");
    expect(found?.eventType).toBe("cataclysm");
    expect(found?.status).toBe("draft");
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("returns null when event is not found by id", async () => {
    const found = await repository.findById(eventIds[0]);

    expect(found).toBeNull();
  });

  it("finds all events by project id ordered by updatedAt descending", async () => {
    const first = createEvent(eventIds[0], "Founding of the Azure Cloud Sect");
    const second = createEvent(eventIds[1], "Ninth Heaven Tribulation");

    await insertEvent(first);
    await insertEvent(second);

    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(2);
    expect(found[0].id).toBe(second.id);
    expect(found[1].id).toBe(first.id);
  });

  it("returns empty array when project has no events", async () => {
    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(0);
  });

  it("round-trips a null timelineOrder and a set one through the mapper", async () => {
    const unplaced = createEvent(eventIds[0], "Rumor of the Hollow Meridian");
    const placed = createEvent(eventIds[1], "Spirit Vein Rupture", {
      timelineOrder: 7,
    });

    await insertEvent(unplaced);
    await insertEvent(placed);

    expect((await repository.findById(unplaced.id))?.timelineOrder).toBeNull();
    expect((await repository.findById(placed.id))?.timelineOrder).toBe(7);
  });

  it("persists detail updates through the mapper", async () => {
    const event = createEvent(eventIds[0], "Unnamed Calamity");
    await insertEvent(event);

    event.updateDetails({
      title: "Fall of the Cloudpiercing Terrace",
      description: "The terrace lost its qi anchor and sank into the ravine.",
      content: "Full account of the collapse.",
      timelineOrder: 3,
      significance: "regional",
      now: later,
    });
    await repository.update(event);

    const persisted = await repository.findById(event.id);

    expect(persisted?.title).toBe("Fall of the Cloudpiercing Terrace");
    expect(persisted?.description).toBe(
      "The terrace lost its qi anchor and sank into the ravine.",
    );
    expect(persisted?.content).toBe("Full account of the collapse.");
    expect(persisted?.timelineOrder).toBe(3);
    expect(persisted?.significance).toBe("regional");
  });

  it("persists a status transition through the mapper", async () => {
    const event = createEvent(eventIds[0], "Sealing of the Demon Ridge", {
      content: "The ridge was sealed by seven elders.",
    });
    await insertEvent(event);

    event.changeStatus("published", later);
    await repository.update(event);

    const persisted = await repository.findById(event.id);

    expect(persisted?.status).toBe("published");
  });

  it("starts a fresh event at version 0 and increments on each update", async () => {
    const event = createEvent(eventIds[0], "First Ascension Trial");
    await insertEvent(event);

    expect((await repository.findById(event.id))?.version).toBe(0);

    const loaded = await repository.findById(event.id);
    if (!loaded) throw new Error("test fixture: event missing");
    loaded.updateDetails({ title: "Second Ascension Trial", now: later });
    await repository.update(loaded);

    expect((await repository.findById(event.id))?.version).toBe(1);
  });

  it("insert() alone persists a null current_revision_id, pending linkRevision", async () => {
    const event = createEvent(eventIds[0], "Pending Chronicle Entry");

    await repository.insert(event);

    const row = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { currentRevisionId: true, version: true },
    });

    expect(row.currentRevisionId).toBeNull();
    expect(row.version).toBe(0);
  });

  it("linkRevision sets currentRevisionId without bumping version", async () => {
    const event = createEvent(eventIds[0], "Newborn Chronicle Entry");
    await repository.insert(event);

    await repository.linkRevision(event.id, revisionId, 0);

    const persisted = await repository.findById(event.id);

    expect(persisted?.currentRevisionId).toBe(revisionId);
    expect(persisted?.version).toBe(0);
  });

  it("rejects linkRevision with a stale expectedVersion as a conflict", async () => {
    const event = createEvent(eventIds[0], "Contested Chronicle Entry");
    await repository.insert(event);

    await expect(
      repository.linkRevision(event.id, revisionId, 1),
    ).rejects.toBeInstanceOf(EventRepositoryConflictError);

    const row = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { currentRevisionId: true },
    });
    expect(row.currentRevisionId).toBeNull();
  });

  it("rejects linkRevision called again on an already-linked entity", async () => {
    const event = createEvent(eventIds[0], "Already Linked Entry");
    await repository.insert(event);
    await repository.linkRevision(event.id, revisionId, 0);

    await expect(
      repository.linkRevision(event.id, revisionId, 0),
    ).rejects.toBeInstanceOf(EventRepositoryConflictError);
  });

  it("maps linkRevision on a missing target to a neutral not-found error", async () => {
    await expect(
      repository.linkRevision(eventIds[0], revisionId, 0),
    ).rejects.toBeInstanceOf(EventRepositoryNotFoundError);
  });

  it("rejects update with a stale version as a conflict", async () => {
    const event = createEvent(eventIds[0], "Contested Record");
    await insertEvent(event);

    const loaded = await repository.findById(event.id);
    if (!loaded) throw new Error("test fixture: event missing");

    // A second writer commits first, bumping version under the stale snapshot.
    loaded.updateDetails({ title: "Won The Race", now: later });
    await repository.update(loaded);

    const current = await repository.findById(event.id);
    if (!current) throw new Error("test fixture: event missing");
    const staleAtOldVersion = Event.reconstitute({
      ...current.toSnapshot(),
      version: 0,
    });
    staleAtOldVersion.updateDetails({ title: "Lost The Race", now: later });

    await expect(repository.update(staleAtOldVersion)).rejects.toBeInstanceOf(
      EventRepositoryConflictError,
    );
  });

  it("deletes an event", async () => {
    const event = createEvent(eventIds[0], "Disposable Record");
    await insertEvent(event);

    await repository.delete(event.id, event.version);

    expect(await repository.findById(event.id)).toBeNull();
  });

  it("rejects delete with a stale version as a conflict and leaves the row intact", async () => {
    const event = createEvent(eventIds[0], "Guarded Record");
    await insertEvent(event);

    const loaded = await repository.findById(event.id);
    if (!loaded) throw new Error("test fixture: event missing");
    loaded.updateDetails({ title: "Won The Race", now: later });
    await repository.update(loaded);

    await expect(repository.delete(event.id, 0)).rejects.toBeInstanceOf(
      EventRepositoryConflictError,
    );

    expect(await repository.findById(event.id)).not.toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    const event = createEvent(eventIds[0], "Original Record");
    const duplicate = createEvent(eventIds[0], "Duplicate Record");

    await insertEvent(event);

    await expect(insertEvent(duplicate)).rejects.toBeInstanceOf(
      EventRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const event = createEvent(eventIds[0], "Ghost Record");

    await expect(repository.update(event)).rejects.toBeInstanceOf(
      EventRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(eventIds[0], 0)).rejects.toBeInstanceOf(
      EventRepositoryNotFoundError,
    );
  });
});
