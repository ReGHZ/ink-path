import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { WorldElement } from "../../src/domains/content/internal/domain/world/WorldElement.js";
import {
  WorldElementRepositoryConflictError,
  WorldElementRepositoryNotFoundError,
  WorldElementRepositoryReferencedError,
} from "../../src/domains/content/internal/domain/world/WorldElementRepositoryError.js";
import { PrismaWorldElementRepository } from "../../src/domains/content/internal/infrastructure/world/PrismaWorldElementRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const later = new Date("2026-07-15T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000601";
const projectId = "00000000-0000-4000-8000-000000000602";
const revisionId = "00000000-0000-4000-8000-000000000603";

const worldElementIds = [
  "55555555-0000-4000-8000-000000000001",
  "55555555-0000-4000-8000-000000000002",
];

const commentId = "55555555-0000-4000-8000-000000000010";
const commentTargetId = "55555555-0000-4000-8000-000000000011";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaWorldElementRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.commentTargetWorldElement.deleteMany({
    where: { commentTargetId },
  });
  await client.commentTarget.deleteMany({ where: { id: commentTargetId } });
  await client.comment.deleteMany({ where: { id: commentId } });
  await client.worldElement.deleteMany({ where: { id: { in: worldElementIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectAndRevision(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "world-element-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "World element test project",
    now,
  });
  await projects.insert(project);

  // No Domain/repository exists yet for ContentRevision, so it is seeded
  // directly through Prisma. `entityId` is a plain UUID column (no FK), so it
  // does not need to reference a real world element.
  await prisma.contentRevision.create({
    data: {
      id: revisionId,
      projectId,
      entityType: "world_element",
      entityId: worldElementIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      // `content_revisions_snapshot_presence` requires afterSnapshot on a
      // "create" revision.
      afterSnapshot: {},
    },
  });
}

function createWorldElement(id: string, name: string): WorldElement {
  return WorldElement.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    name,
    category: "geography",
    currentRevisionId: revisionId,
    now,
  });
}

// insert() always persists a null currentRevisionId regardless of what the
// entity carries — the FK to content_revisions is not DEFERRABLE, so the
// physical row cannot point at a revision yet (see WorldElementRepository.
// linkRevision doc comment). These tests aren't exercising the create-flow
// itself; they need a fully "created" row (revision already linked) as their
// starting fixture, same shape the old insert() produced, so patch it
// directly here via raw Prisma instead of the version-guarded update().
async function insertWorldElement(element: WorldElement): Promise<void> {
  await repository.insert(element);
  await prisma.worldElement.update({
    where: { id: element.id },
    data: { currentRevisionId: revisionId },
  });
}

describe("PrismaWorldElementRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectAndRevision();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a world element by id", async () => {
    const element = createWorldElement(worldElementIds[0], "Dragon Range");

    await insertWorldElement(element);

    const found = await repository.findById(element.id);

    expect(found?.id).toBe(element.id);
    expect(found?.name).toBe("Dragon Range");
    expect(found?.projectId).toBe(projectId);
    expect(found?.category).toBe("geography");
    expect(found?.status).toBe("draft");
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("returns null when world element is not found by id", async () => {
    const found = await repository.findById(worldElementIds[0]);

    expect(found).toBeNull();
  });

  it("finds all world elements by project id ordered by updatedAt descending", async () => {
    const first = createWorldElement(worldElementIds[0], "First Element");
    const second = createWorldElement(worldElementIds[1], "Second Element");

    // Insert sequentially: second is inserted after first, so DB
    // @updatedAt(second) > @updatedAt(first).
    await insertWorldElement(first);
    await insertWorldElement(second);

    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(2);
    expect(found[0].id).toBe(second.id);
    expect(found[1].id).toBe(first.id);
  });

  it("returns empty array when project has no world elements", async () => {
    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(0);
  });

  it("persists detail updates through the mapper", async () => {
    const element = createWorldElement(worldElementIds[0], "Draft Setting");
    await insertWorldElement(element);

    element.updateDetails({
      name: "Revised Setting",
      description: "A windswept coastal town",
      category: "landmark",
      content: "Body text",
      now: later,
    });
    await repository.update(element);

    const persisted = await repository.findById(element.id);

    expect(persisted?.name).toBe("Revised Setting");
    expect(persisted?.description).toBe("A windswept coastal town");
    expect(persisted?.category).toBe("landmark");
    expect(persisted?.content).toBe("Body text");
    expect(persisted?.updatedAt).toEqual(expect.any(Date));
  });

  it("persists a status transition through the mapper", async () => {
    const element = createWorldElement(worldElementIds[0], "Draft Setting");
    element.updateDetails({ content: "Body text", now });
    await insertWorldElement(element);

    element.changeStatus("published", later);
    await repository.update(element);

    const persisted = await repository.findById(element.id);

    expect(persisted?.status).toBe("published");
  });

  it("starts a fresh world element at version 0", async () => {
    const element = createWorldElement(worldElementIds[0], "Fresh Element");

    await insertWorldElement(element);

    const persisted = await repository.findById(element.id);

    expect(persisted?.version).toBe(0);
  });

  it("insert() alone persists a null current_revision_id, pending linkRevision", async () => {
    const element = createWorldElement(worldElementIds[0], "Pending Element");

    await repository.insert(element);

    const row = await prisma.worldElement.findUniqueOrThrow({
      where: { id: element.id },
      select: { currentRevisionId: true, version: true },
    });

    expect(row.currentRevisionId).toBeNull();
    expect(row.version).toBe(0);
  });

  it("linkRevision sets currentRevisionId without bumping version", async () => {
    const element = createWorldElement(worldElementIds[0], "Newborn Element");
    await repository.insert(element);

    await repository.linkRevision(element.id, revisionId, 0);

    const persisted = await repository.findById(element.id);

    expect(persisted?.currentRevisionId).toBe(revisionId);
    expect(persisted?.version).toBe(0);
  });

  it("rejects linkRevision with a stale expectedVersion as a conflict", async () => {
    const element = createWorldElement(worldElementIds[0], "Contested Element");
    await repository.insert(element);

    await expect(
      repository.linkRevision(element.id, revisionId, 1),
    ).rejects.toBeInstanceOf(WorldElementRepositoryConflictError);

    const row = await prisma.worldElement.findUniqueOrThrow({
      where: { id: element.id },
      select: { currentRevisionId: true },
    });
    expect(row.currentRevisionId).toBeNull();
  });

  it("maps linkRevision on a missing target to a neutral not-found error", async () => {
    await expect(
      repository.linkRevision(worldElementIds[0], revisionId, 0),
    ).rejects.toBeInstanceOf(WorldElementRepositoryNotFoundError);
  });

  it("rejects linkRevision called again on an already-linked entity", async () => {
    const element = createWorldElement(worldElementIds[0], "Already Linked");
    await repository.insert(element);
    await repository.linkRevision(element.id, revisionId, 0);

    await expect(
      repository.linkRevision(element.id, revisionId, 0),
    ).rejects.toBeInstanceOf(WorldElementRepositoryConflictError);
  });

  it("increments version on each persisted update", async () => {
    const element = createWorldElement(worldElementIds[0], "Draft Setting");
    await insertWorldElement(element);

    const first = await repository.findById(element.id);
    if (!first) throw new Error("test fixture: world element missing");
    first.updateDetails({ name: "Revised Once", now: later });
    await repository.update(first);

    const second = await repository.findById(element.id);
    if (!second) throw new Error("test fixture: world element missing");
    second.updateDetails({ name: "Revised Twice", now: later });
    await repository.update(second);

    const persisted = await repository.findById(element.id);

    expect(persisted?.version).toBe(2);
  });

  it("rejects update with a stale version as a conflict", async () => {
    const element = createWorldElement(worldElementIds[0], "Draft Setting");
    await insertWorldElement(element);

    const loaded = await repository.findById(element.id);
    if (!loaded) throw new Error("test fixture: world element missing");
    expect(loaded.version).toBe(0);

    // A second writer commits first: bump version underneath the stale snapshot.
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    // Re-read at the bumped version, then forge a stale snapshot back at v0.
    const current = await repository.findById(element.id);
    if (!current) throw new Error("test fixture: world element missing");
    const staleAtOldVersion = WorldElement.reconstitute({
      ...current.toSnapshot(),
      version: 0,
    });
    staleAtOldVersion.updateDetails({ name: "Lost The Race", now: later });

    await expect(repository.update(staleAtOldVersion)).rejects.toBeInstanceOf(
      WorldElementRepositoryConflictError,
    );
  });

  it("deletes a world element", async () => {
    const element = createWorldElement(worldElementIds[0], "Disposable Element");
    await insertWorldElement(element);

    await repository.delete(element.id, element.version);

    const found = await repository.findById(element.id);

    expect(found).toBeNull();
  });

  it("rejects delete with a stale version as a conflict", async () => {
    const element = createWorldElement(worldElementIds[0], "Draft Setting");
    await insertWorldElement(element);

    const loaded = await repository.findById(element.id);
    if (!loaded) throw new Error("test fixture: world element missing");
    expect(loaded.version).toBe(0);

    // A second writer commits an edit first: bump version underneath the
    // stale snapshot the delete is about to be issued against.
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    await expect(repository.delete(element.id, 0)).rejects.toBeInstanceOf(
      WorldElementRepositoryConflictError,
    );

    // The failed delete must not have removed the row.
    const found = await repository.findById(element.id);
    expect(found).not.toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    const element = createWorldElement(worldElementIds[0], "My Element");
    const duplicate = createWorldElement(worldElementIds[0], "Duplicate Element");

    await insertWorldElement(element);

    await expect(insertWorldElement(duplicate)).rejects.toBeInstanceOf(
      WorldElementRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const element = createWorldElement(worldElementIds[0], "Ghost Element");

    await expect(repository.update(element)).rejects.toBeInstanceOf(
      WorldElementRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(worldElementIds[0], 0)).rejects.toBeInstanceOf(
      WorldElementRepositoryNotFoundError,
    );
  });

  // WorldElement has no parentId/self-hierarchy, so unlike Layer/WorldMap the
  // FK block on delete cannot come from a child pointing back at its parent.
  // It comes from a different source instead:
  // `comment_target_world_elements_world_element_id_fkey`
  // (`CommentTargetWorldElement.worldElement`, `onDelete: Restrict`). No
  // Domain/repository exists yet for the Feedback domain, so the Comment /
  // CommentTarget / CommentTargetWorldElement rows are seeded directly
  // through Prisma, the same way `contentRevision` is seeded elsewhere in
  // this file.
  it("maps deleting a world element still targeted by a comment to ReferencedError", async () => {
    const element = createWorldElement(worldElementIds[0], "Commented Element");
    await insertWorldElement(element);

    await prisma.comment.create({
      data: {
        id: commentId,
        projectId,
        content: "This mountain range needs a name.",
        type: "general",
        createdByUserId: ownerUserId,
      },
    });
    await prisma.commentTarget.create({
      data: {
        id: commentTargetId,
        commentId,
        projectId,
      },
    });
    await prisma.commentTargetWorldElement.create({
      data: {
        commentTargetId,
        worldElementId: element.id,
      },
    });

    await expect(
      repository.delete(element.id, element.version),
    ).rejects.toBeInstanceOf(WorldElementRepositoryReferencedError);

    // The failed delete must not have removed the row.
    const found = await repository.findById(element.id);
    expect(found).not.toBeNull();
  });
});
