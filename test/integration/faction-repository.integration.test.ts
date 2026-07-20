import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Faction } from "../../src/domains/content/internal/domain/story/Faction.js";
import {
  FactionRepositoryConflictError,
  FactionRepositoryNotFoundError,
  FactionRepositoryReferencedError,
} from "../../src/domains/content/internal/domain/story/FactionRepositoryError.js";
import { PrismaFactionRepository } from "../../src/domains/content/internal/infrastructure/story/PrismaFactionRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const later = new Date("2026-07-15T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000801";
const projectId = "00000000-0000-4000-8000-000000000802";
const revisionId = "00000000-0000-4000-8000-000000000803";

const factionIds = [
  "77777777-0000-4000-8000-000000000001",
  "77777777-0000-4000-8000-000000000002",
];

const commentId = "77777777-0000-4000-8000-000000000010";
const commentTargetId = "77777777-0000-4000-8000-000000000011";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaFactionRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.commentTargetFaction.deleteMany({
    where: { commentTargetId },
  });
  await client.commentTarget.deleteMany({ where: { id: commentTargetId } });
  await client.comment.deleteMany({ where: { id: commentId } });
  await client.faction.deleteMany({ where: { id: { in: factionIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectAndRevision(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "faction-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Faction test project",
    now,
  });
  await projects.insert(project);

  // No Domain/repository exists yet for ContentRevision, so it is seeded
  // directly through Prisma. `entityId` is a plain UUID column (no FK), so it
  // does not need to reference a real faction.
  await prisma.contentRevision.create({
    data: {
      id: revisionId,
      projectId,
      entityType: "faction",
      entityId: factionIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      // `content_revisions_snapshot_presence` requires afterSnapshot on a
      // "create" revision.
      afterSnapshot: {},
    },
  });
}

function createFaction(id: string, name: string): Faction {
  return Faction.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    name,
    currentRevisionId: revisionId,
    now,
  });
}

// insert() always persists a null currentRevisionId regardless of what the
// entity carries — the FK to content_revisions is not DEFERRABLE, so the
// physical row cannot point at a revision yet (see FactionRepository.
// linkRevision doc comment). These tests aren't exercising the create-flow
// itself; they need a fully "created" row (revision already linked) as their
// starting fixture, same shape the old insert() produced, so patch it
// directly here via raw Prisma instead of the version-guarded update().
async function insertFaction(faction: Faction): Promise<void> {
  await repository.insert(faction);
  await prisma.faction.update({
    where: { id: faction.id },
    data: { currentRevisionId: revisionId },
  });
}

describe("PrismaFactionRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectAndRevision();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a faction by id", async () => {
    const faction = createFaction(factionIds[0], "The Cartographers' Guild");

    await insertFaction(faction);

    const found = await repository.findById(faction.id);

    expect(found?.id).toBe(faction.id);
    expect(found?.name).toBe("The Cartographers' Guild");
    expect(found?.projectId).toBe(projectId);
    expect(found?.status).toBe("draft");
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("returns null when faction is not found by id", async () => {
    const found = await repository.findById(factionIds[0]);

    expect(found).toBeNull();
  });

  it("finds all factions by project id ordered by updatedAt descending", async () => {
    const first = createFaction(factionIds[0], "First Faction");
    const second = createFaction(factionIds[1], "Second Faction");

    // Insert sequentially: second is inserted after first, so DB
    // @updatedAt(second) > @updatedAt(first).
    await insertFaction(first);
    await insertFaction(second);

    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(2);
    expect(found[0].id).toBe(second.id);
    expect(found[1].id).toBe(first.id);
  });

  it("returns empty array when project has no factions", async () => {
    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(0);
  });

  it("persists detail updates through the mapper", async () => {
    const faction = createFaction(factionIds[0], "Draft Faction");
    await insertFaction(faction);

    faction.updateDetails({
      name: "Revised Faction",
      description: "Updated description",
      background: "Updated background",
      ideology: "Updated ideology",
      size: "large",
      content: "Body text",
      now: later,
    });
    await repository.update(faction);

    const persisted = await repository.findById(faction.id);

    expect(persisted?.name).toBe("Revised Faction");
    expect(persisted?.description).toBe("Updated description");
    expect(persisted?.background).toBe("Updated background");
    expect(persisted?.ideology).toBe("Updated ideology");
    expect(persisted?.size).toBe("large");
    expect(persisted?.content).toBe("Body text");
    expect(persisted?.updatedAt).toEqual(expect.any(Date));
  });

  it("persists a status transition through the mapper", async () => {
    const faction = createFaction(factionIds[0], "Draft Faction");
    faction.updateDetails({
      description: "D",
      background: "B",
      now,
    });
    await insertFaction(faction);

    faction.changeStatus("active", later);
    await repository.update(faction);

    const persisted = await repository.findById(faction.id);

    expect(persisted?.status).toBe("active");
  });

  it("starts a fresh faction at version 0", async () => {
    const faction = createFaction(factionIds[0], "Fresh Faction");

    await insertFaction(faction);

    const persisted = await repository.findById(faction.id);

    expect(persisted?.version).toBe(0);
  });

  it("insert() alone persists a null current_revision_id, pending linkRevision", async () => {
    const faction = createFaction(factionIds[0], "Pending Faction");

    await repository.insert(faction);

    const row = await prisma.faction.findUniqueOrThrow({
      where: { id: faction.id },
      select: { currentRevisionId: true, version: true },
    });

    expect(row.currentRevisionId).toBeNull();
    expect(row.version).toBe(0);
  });

  it("linkRevision sets currentRevisionId without bumping version", async () => {
    const faction = createFaction(factionIds[0], "Newborn Faction");
    await repository.insert(faction);

    await repository.linkRevision(faction.id, revisionId, 0);

    const persisted = await repository.findById(faction.id);

    expect(persisted?.currentRevisionId).toBe(revisionId);
    expect(persisted?.version).toBe(0);
  });

  it("rejects linkRevision with a stale expectedVersion as a conflict", async () => {
    const faction = createFaction(factionIds[0], "Contested Faction");
    await repository.insert(faction);

    await expect(
      repository.linkRevision(faction.id, revisionId, 1),
    ).rejects.toBeInstanceOf(FactionRepositoryConflictError);

    const row = await prisma.faction.findUniqueOrThrow({
      where: { id: faction.id },
      select: { currentRevisionId: true },
    });
    expect(row.currentRevisionId).toBeNull();
  });

  it("maps linkRevision on a missing target to a neutral not-found error", async () => {
    await expect(
      repository.linkRevision(factionIds[0], revisionId, 0),
    ).rejects.toBeInstanceOf(FactionRepositoryNotFoundError);
  });

  it("rejects linkRevision called again on an already-linked entity", async () => {
    const faction = createFaction(factionIds[0], "Already Linked");
    await repository.insert(faction);
    await repository.linkRevision(faction.id, revisionId, 0);

    await expect(
      repository.linkRevision(faction.id, revisionId, 0),
    ).rejects.toBeInstanceOf(FactionRepositoryConflictError);
  });

  it("increments version on each persisted update", async () => {
    const faction = createFaction(factionIds[0], "Draft Faction");
    await insertFaction(faction);

    const first = await repository.findById(faction.id);
    if (!first) throw new Error("test fixture: faction missing");
    first.updateDetails({ name: "Revised Once", now: later });
    await repository.update(first);

    const second = await repository.findById(faction.id);
    if (!second) throw new Error("test fixture: faction missing");
    second.updateDetails({ name: "Revised Twice", now: later });
    await repository.update(second);

    const persisted = await repository.findById(faction.id);

    expect(persisted?.version).toBe(2);
  });

  it("rejects update with a stale version as a conflict", async () => {
    const faction = createFaction(factionIds[0], "Draft Faction");
    await insertFaction(faction);

    const loaded = await repository.findById(faction.id);
    if (!loaded) throw new Error("test fixture: faction missing");
    expect(loaded.version).toBe(0);

    // A second writer commits first: bump version underneath the stale snapshot.
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    // Re-read at the bumped version, then forge a stale snapshot back at v0.
    const current = await repository.findById(faction.id);
    if (!current) throw new Error("test fixture: faction missing");
    const staleAtOldVersion = Faction.reconstitute({
      ...current.toSnapshot(),
      version: 0,
    });
    staleAtOldVersion.updateDetails({ name: "Lost The Race", now: later });

    await expect(repository.update(staleAtOldVersion)).rejects.toBeInstanceOf(
      FactionRepositoryConflictError,
    );
  });

  it("deletes a faction", async () => {
    const faction = createFaction(factionIds[0], "Disposable Faction");
    await insertFaction(faction);

    await repository.delete(faction.id, faction.version);

    const found = await repository.findById(faction.id);

    expect(found).toBeNull();
  });

  it("rejects delete with a stale version as a conflict", async () => {
    const faction = createFaction(factionIds[0], "Draft Faction");
    await insertFaction(faction);

    const loaded = await repository.findById(faction.id);
    if (!loaded) throw new Error("test fixture: faction missing");
    expect(loaded.version).toBe(0);

    // A second writer commits an edit first: bump version underneath the
    // stale snapshot the delete is about to be issued against.
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    await expect(repository.delete(faction.id, 0)).rejects.toBeInstanceOf(
      FactionRepositoryConflictError,
    );

    // The failed delete must not have removed the row.
    const found = await repository.findById(faction.id);
    expect(found).not.toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    const faction = createFaction(factionIds[0], "My Faction");
    const duplicate = createFaction(factionIds[0], "Duplicate Faction");

    await insertFaction(faction);

    await expect(insertFaction(duplicate)).rejects.toBeInstanceOf(
      FactionRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const faction = createFaction(factionIds[0], "Ghost Faction");

    await expect(repository.update(faction)).rejects.toBeInstanceOf(
      FactionRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(factionIds[0], 0)).rejects.toBeInstanceOf(
      FactionRepositoryNotFoundError,
    );
  });

  // Faction has no parentId/self-hierarchy, so unlike Layer/WorldMap the FK
  // block on delete cannot come from a child pointing back at its parent. It
  // comes from a different source instead:
  // `comment_target_factions_faction_id_fkey`
  // (`CommentTargetFaction.faction`, `onDelete: Restrict`). No Domain/
  // repository exists yet for the Feedback domain, so the Comment /
  // CommentTarget / CommentTargetFaction rows are seeded directly through
  // Prisma, the same way `contentRevision` is seeded elsewhere in this file.
  it("maps deleting a faction still targeted by a comment to ReferencedError", async () => {
    const faction = createFaction(factionIds[0], "Commented Faction");
    await insertFaction(faction);

    await prisma.comment.create({
      data: {
        id: commentId,
        projectId,
        content: "This faction needs a clearer ideology.",
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
    await prisma.commentTargetFaction.create({
      data: {
        commentTargetId,
        factionId: faction.id,
      },
    });

    await expect(
      repository.delete(faction.id, faction.version),
    ).rejects.toBeInstanceOf(FactionRepositoryReferencedError);

    // The failed delete must not have removed the row.
    const found = await repository.findById(faction.id);
    expect(found).not.toBeNull();
  });
});
