import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { WorldMap } from "../../src/domains/content/internal/domain/world/WorldMap.js";
import {
  WorldMapRepositoryConflictError,
  WorldMapRepositoryNotFoundError,
  WorldMapRepositoryParentNotFoundError,
  WorldMapRepositoryReferencedError,
} from "../../src/domains/content/internal/domain/world/WorldMapRepositoryError.js";
import { PrismaWorldMapRepository } from "../../src/domains/content/internal/infrastructure/world/PrismaWorldMapRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const later = new Date("2026-07-15T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000501";
const projectId = "00000000-0000-4000-8000-000000000502";
const revisionId = "00000000-0000-4000-8000-000000000503";

const mapIds = [
  "44444444-0000-4000-8000-000000000001",
  "44444444-0000-4000-8000-000000000002",
  "44444444-0000-4000-8000-000000000003",
];

const bogusParentId = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaWorldMapRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  // Children before parents: this table self-references via `parentId`
  // (`onDelete: Restrict`), so parents must not be deleted while a child in
  // the same cleanup batch still points at them.
  await client.map.deleteMany({
    where: { id: { in: mapIds }, parentId: { not: null } },
  });
  await client.map.deleteMany({ where: { id: { in: mapIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectAndRevision(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "map-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Map test project",
    now,
  });
  await projects.insert(project);

  // No Domain/repository exists yet for ContentRevision, so it is seeded
  // directly through Prisma. `entityId` is a plain UUID column (no FK), so it
  // does not need to reference a real map.
  await prisma.contentRevision.create({
    data: {
      id: revisionId,
      projectId,
      entityType: "map",
      entityId: mapIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      // `content_revisions_snapshot_presence` requires afterSnapshot on a
      // "create" revision.
      afterSnapshot: {},
    },
  });
}

function createWorldMap(
  id: string,
  name: string,
  overrides: { parentId?: string | null } = {},
): WorldMap {
  return WorldMap.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    parentId: overrides.parentId ?? null,
    name,
    currentRevisionId: revisionId,
    now,
  });
}

describe("PrismaWorldMapRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectAndRevision();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a map by id", async () => {
    const map = createWorldMap(mapIds[0], "Continent of Vael");

    await repository.insert(map);

    const found = await repository.findById(map.id);

    expect(found?.id).toBe(map.id);
    expect(found?.name).toBe("Continent of Vael");
    expect(found?.projectId).toBe(projectId);
    expect(found?.parentId).toBeNull();
    expect(found?.status).toBe("draft");
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("returns null when map is not found by id", async () => {
    const found = await repository.findById(mapIds[0]);

    expect(found).toBeNull();
  });

  it("finds all maps by project id ordered by updatedAt descending", async () => {
    const first = createWorldMap(mapIds[0], "First Map");
    const second = createWorldMap(mapIds[1], "Second Map");

    // Insert sequentially: second is inserted after first, so DB
    // @updatedAt(second) > @updatedAt(first).
    await repository.insert(first);
    await repository.insert(second);

    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(2);
    expect(found[0].id).toBe(second.id);
    expect(found[1].id).toBe(first.id);
  });

  it("returns empty array when project has no maps", async () => {
    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(0);
  });

  it("inserts a map with a valid parent id", async () => {
    const parent = createWorldMap(mapIds[0], "Parent Map");
    await repository.insert(parent);

    const child = createWorldMap(mapIds[1], "Child Map", {
      parentId: parent.id,
    });
    await repository.insert(child);

    const found = await repository.findById(child.id);

    expect(found?.parentId).toBe(parent.id);
  });

  it("persists detail updates through the mapper", async () => {
    const map = createWorldMap(mapIds[0], "Draft Map");
    await repository.insert(map);

    map.updateDetails({
      name: "Revised Map",
      scale: "1:50000",
      terrain: "coastal",
      environment: "arid",
      description: "A windswept coastal region",
      content: "Body text",
      now: later,
    });
    await repository.update(map);

    const persisted = await repository.findById(map.id);

    expect(persisted?.name).toBe("Revised Map");
    expect(persisted?.scale).toBe("1:50000");
    expect(persisted?.terrain).toBe("coastal");
    expect(persisted?.environment).toBe("arid");
    expect(persisted?.description).toBe("A windswept coastal region");
    expect(persisted?.content).toBe("Body text");
    expect(persisted?.updatedAt).toEqual(expect.any(Date));
  });

  it("persists a status transition through the mapper", async () => {
    const map = createWorldMap(mapIds[0], "Draft Map");
    map.updateDetails({ content: "Body text", now });
    await repository.insert(map);

    map.changeStatus("published", later);
    await repository.update(map);

    const persisted = await repository.findById(map.id);

    expect(persisted?.status).toBe("published");
  });

  it("starts a fresh map at version 0", async () => {
    const map = createWorldMap(mapIds[0], "Fresh Map");

    await repository.insert(map);

    const persisted = await repository.findById(map.id);

    expect(persisted?.version).toBe(0);
  });

  it("increments version on each persisted update", async () => {
    const map = createWorldMap(mapIds[0], "Draft Map");
    await repository.insert(map);

    const first = await repository.findById(map.id);
    if (!first) throw new Error("test fixture: map missing");
    first.updateDetails({ name: "Revised Once", now: later });
    await repository.update(first);

    const second = await repository.findById(map.id);
    if (!second) throw new Error("test fixture: map missing");
    second.updateDetails({ name: "Revised Twice", now: later });
    await repository.update(second);

    const persisted = await repository.findById(map.id);

    expect(persisted?.version).toBe(2);
  });

  it("rejects update with a stale version as a conflict", async () => {
    const map = createWorldMap(mapIds[0], "Draft Map");
    await repository.insert(map);

    const loaded = await repository.findById(map.id);
    if (!loaded) throw new Error("test fixture: map missing");
    expect(loaded.version).toBe(0);

    // A second writer commits first: bump version underneath the stale snapshot.
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    // Re-read at the bumped version, then forge a stale snapshot back at v0.
    const current = await repository.findById(map.id);
    if (!current) throw new Error("test fixture: map missing");
    const staleAtOldVersion = WorldMap.reconstitute({
      ...current.toSnapshot(),
      version: 0,
    });
    staleAtOldVersion.updateDetails({ name: "Lost The Race", now: later });

    await expect(repository.update(staleAtOldVersion)).rejects.toBeInstanceOf(
      WorldMapRepositoryConflictError,
    );
  });

  it("deletes a map", async () => {
    const map = createWorldMap(mapIds[0], "Disposable Map");
    await repository.insert(map);

    await repository.delete(map.id, map.version);

    const found = await repository.findById(map.id);

    expect(found).toBeNull();
  });

  it("rejects delete with a stale version as a conflict", async () => {
    const map = createWorldMap(mapIds[0], "Draft Map");
    await repository.insert(map);

    const loaded = await repository.findById(map.id);
    if (!loaded) throw new Error("test fixture: map missing");
    expect(loaded.version).toBe(0);

    // A second writer commits an edit first: bump version underneath the
    // stale snapshot the delete is about to be issued against.
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    await expect(repository.delete(map.id, 0)).rejects.toBeInstanceOf(
      WorldMapRepositoryConflictError,
    );

    // The failed delete must not have removed the row.
    const found = await repository.findById(map.id);
    expect(found).not.toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    const map = createWorldMap(mapIds[0], "My Map");
    const duplicate = createWorldMap(mapIds[0], "Duplicate Map");

    await repository.insert(map);

    await expect(repository.insert(duplicate)).rejects.toBeInstanceOf(
      WorldMapRepositoryConflictError,
    );
  });

  it("maps an insert with a non-existent parent id to ParentNotFoundError", async () => {
    const map = createWorldMap(mapIds[0], "Orphan Map", {
      parentId: bogusParentId,
    });

    await expect(repository.insert(map)).rejects.toBeInstanceOf(
      WorldMapRepositoryParentNotFoundError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const map = createWorldMap(mapIds[0], "Ghost Map");

    await expect(repository.update(map)).rejects.toBeInstanceOf(
      WorldMapRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(mapIds[0], 0)).rejects.toBeInstanceOf(
      WorldMapRepositoryNotFoundError,
    );
  });

  it("maps deleting a map that still has children to ReferencedError", async () => {
    const parent = createWorldMap(mapIds[0], "Parent Map");
    await repository.insert(parent);

    const child = createWorldMap(mapIds[1], "Child Map", {
      parentId: parent.id,
    });
    await repository.insert(child);

    await expect(repository.delete(parent.id, parent.version)).rejects.toBeInstanceOf(
      WorldMapRepositoryReferencedError,
    );

    // The parent must remain intact — the failed delete is not partial.
    const found = await repository.findById(parent.id);
    expect(found).not.toBeNull();
  });
});
