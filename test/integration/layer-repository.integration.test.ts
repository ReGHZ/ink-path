import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Layer } from "../../src/domains/content/internal/domain/world/Layer.js";
import {
  LayerRepositoryConflictError,
  LayerRepositoryNotFoundError,
  LayerRepositoryParentNotFoundError,
  LayerRepositoryReferencedError,
} from "../../src/domains/content/internal/domain/world/LayerRepositoryError.js";
import { PrismaLayerRepository } from "../../src/domains/content/internal/infrastructure/world/PrismaLayerRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const later = new Date("2026-07-15T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000401";
const projectId = "00000000-0000-4000-8000-000000000402";
const revisionId = "00000000-0000-4000-8000-000000000403";

const layerIds = [
  "33333333-0000-4000-8000-000000000001",
  "33333333-0000-4000-8000-000000000002",
  "33333333-0000-4000-8000-000000000003",
];

const bogusParentId = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaLayerRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  // Children before parents: this table self-references via `parentId`
  // (`onDelete: Restrict`), so parents must not be deleted while a child in
  // the same cleanup batch still points at them.
  await client.layer.deleteMany({
    where: { id: { in: layerIds }, parentId: { not: null } },
  });
  await client.layer.deleteMany({ where: { id: { in: layerIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectAndRevision(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "layer-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Layer test project",
    now,
  });
  await projects.insert(project);

  // No Domain/repository exists yet for ContentRevision, so it is seeded
  // directly through Prisma. `entityId` is a plain UUID column (no FK), so it
  // does not need to reference a real layer.
  await prisma.contentRevision.create({
    data: {
      id: revisionId,
      projectId,
      entityType: "layer",
      entityId: layerIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      // `content_revisions_snapshot_presence` requires afterSnapshot on a
      // "create" revision.
      afterSnapshot: {},
    },
  });
}

function createLayer(
  id: string,
  name: string,
  overrides: { parentId?: string | null } = {},
): Layer {
  return Layer.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    parentId: overrides.parentId ?? null,
    name,
    level: 1,
    exposure: "internal_only",
    currentRevisionId: revisionId,
    now,
  });
}

describe("PrismaLayerRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectAndRevision();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a layer by id", async () => {
    const layer = createLayer(layerIds[0], "Chapter 1 Setting");

    await repository.insert(layer);

    const found = await repository.findById(layer.id);

    expect(found?.id).toBe(layer.id);
    expect(found?.name).toBe("Chapter 1 Setting");
    expect(found?.projectId).toBe(projectId);
    expect(found?.parentId).toBeNull();
    expect(found?.status).toBe("draft");
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("returns null when layer is not found by id", async () => {
    const found = await repository.findById(layerIds[0]);

    expect(found).toBeNull();
  });

  it("finds all layers by project id ordered by updatedAt descending", async () => {
    const first = createLayer(layerIds[0], "First Layer");
    const second = createLayer(layerIds[1], "Second Layer");

    // Insert sequentially: second is inserted after first, so DB
    // @updatedAt(second) > @updatedAt(first).
    await repository.insert(first);
    await repository.insert(second);

    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(2);
    expect(found[0].id).toBe(second.id);
    expect(found[1].id).toBe(first.id);
  });

  it("returns empty array when project has no layers", async () => {
    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(0);
  });

  it("inserts a layer with a valid parent id", async () => {
    const parent = createLayer(layerIds[0], "Parent Layer");
    await repository.insert(parent);

    const child = createLayer(layerIds[1], "Child Layer", {
      parentId: parent.id,
    });
    await repository.insert(child);

    const found = await repository.findById(child.id);

    expect(found?.parentId).toBe(parent.id);
  });

  it("persists detail updates through the mapper", async () => {
    const layer = createLayer(layerIds[0], "Draft Setting");
    await repository.insert(layer);

    layer.updateDetails({
      name: "Revised Setting",
      description: "A windswept coastal town",
      content: "Body text",
      level: 2,
      exposure: "reader_visible",
      now: later,
    });
    await repository.update(layer);

    const persisted = await repository.findById(layer.id);

    expect(persisted?.name).toBe("Revised Setting");
    expect(persisted?.description).toBe("A windswept coastal town");
    expect(persisted?.content).toBe("Body text");
    expect(persisted?.level).toBe(2);
    expect(persisted?.exposure).toBe("reader_visible");
    expect(persisted?.updatedAt).toEqual(expect.any(Date));
  });

  it("persists a status transition through the mapper", async () => {
    const layer = createLayer(layerIds[0], "Draft Setting");
    layer.updateDetails({ content: "Body text", now });
    await repository.insert(layer);

    layer.changeStatus("published", later);
    await repository.update(layer);

    const persisted = await repository.findById(layer.id);

    expect(persisted?.status).toBe("published");
  });

  it("deletes a layer", async () => {
    const layer = createLayer(layerIds[0], "Disposable Layer");
    await repository.insert(layer);

    await repository.delete(layer.id);

    const found = await repository.findById(layer.id);

    expect(found).toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    const layer = createLayer(layerIds[0], "My Layer");
    const duplicate = createLayer(layerIds[0], "Duplicate Layer");

    await repository.insert(layer);

    await expect(repository.insert(duplicate)).rejects.toBeInstanceOf(
      LayerRepositoryConflictError,
    );
  });

  it("maps an insert with a non-existent parent id to ParentNotFoundError", async () => {
    const layer = createLayer(layerIds[0], "Orphan Layer", {
      parentId: bogusParentId,
    });

    await expect(repository.insert(layer)).rejects.toBeInstanceOf(
      LayerRepositoryParentNotFoundError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const layer = createLayer(layerIds[0], "Ghost Layer");

    await expect(repository.update(layer)).rejects.toBeInstanceOf(
      LayerRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(layerIds[0])).rejects.toBeInstanceOf(
      LayerRepositoryNotFoundError,
    );
  });

  it("maps deleting a layer that still has children to ReferencedError", async () => {
    const parent = createLayer(layerIds[0], "Parent Layer");
    await repository.insert(parent);

    const child = createLayer(layerIds[1], "Child Layer", {
      parentId: parent.id,
    });
    await repository.insert(child);

    await expect(repository.delete(parent.id)).rejects.toBeInstanceOf(
      LayerRepositoryReferencedError,
    );

    // The parent must remain intact — the failed delete is not partial.
    const found = await repository.findById(parent.id);
    expect(found).not.toBeNull();
  });
});
