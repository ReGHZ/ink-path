import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Character } from "../../src/domains/content/internal/domain/story/Character.js";
import {
  CharacterRepositoryConflictError,
  CharacterRepositoryNotFoundError,
  CharacterRepositoryReferencedError,
} from "../../src/domains/content/internal/domain/story/CharacterRepositoryError.js";
import { PrismaCharacterRepository } from "../../src/domains/content/internal/infrastructure/story/PrismaCharacterRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const later = new Date("2026-07-15T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000701";
const projectId = "00000000-0000-4000-8000-000000000702";
const revisionId = "00000000-0000-4000-8000-000000000703";

const characterIds = [
  "66666666-0000-4000-8000-000000000001",
  "66666666-0000-4000-8000-000000000002",
];

const commentId = "66666666-0000-4000-8000-000000000010";
const commentTargetId = "66666666-0000-4000-8000-000000000011";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaCharacterRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.commentTargetCharacter.deleteMany({
    where: { commentTargetId },
  });
  await client.commentTarget.deleteMany({ where: { id: commentTargetId } });
  await client.comment.deleteMany({ where: { id: commentId } });
  await client.character.deleteMany({ where: { id: { in: characterIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectAndRevision(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "character-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Character test project",
    now,
  });
  await projects.insert(project);

  // No Domain/repository exists yet for ContentRevision, so it is seeded
  // directly through Prisma. `entityId` is a plain UUID column (no FK), so it
  // does not need to reference a real character.
  await prisma.contentRevision.create({
    data: {
      id: revisionId,
      projectId,
      entityType: "character",
      entityId: characterIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      // `content_revisions_snapshot_presence` requires afterSnapshot on a
      // "create" revision.
      afterSnapshot: {},
    },
  });
}

function createCharacter(id: string, name: string): Character {
  return Character.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    name,
    currentRevisionId: revisionId,
    now,
  });
}

describe("PrismaCharacterRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectAndRevision();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a character by id", async () => {
    const character = createCharacter(characterIds[0], "Kael of Vael");

    await repository.insert(character);

    const found = await repository.findById(character.id);

    expect(found?.id).toBe(character.id);
    expect(found?.name).toBe("Kael of Vael");
    expect(found?.projectId).toBe(projectId);
    expect(found?.status).toBe("draft");
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("returns null when character is not found by id", async () => {
    const found = await repository.findById(characterIds[0]);

    expect(found).toBeNull();
  });

  it("finds all characters by project id ordered by updatedAt descending", async () => {
    const first = createCharacter(characterIds[0], "First Character");
    const second = createCharacter(characterIds[1], "Second Character");

    // Insert sequentially: second is inserted after first, so DB
    // @updatedAt(second) > @updatedAt(first).
    await repository.insert(first);
    await repository.insert(second);

    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(2);
    expect(found[0].id).toBe(second.id);
    expect(found[1].id).toBe(first.id);
  });

  it("returns empty array when project has no characters", async () => {
    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(0);
  });

  it("persists detail updates through the mapper", async () => {
    const character = createCharacter(characterIds[0], "Draft Character");
    await repository.insert(character);

    character.updateDetails({
      name: "Revised Character",
      archetype: "Mentor",
      background: "Updated background",
      personality: "Stoic",
      goal: "New goal",
      description: "Updated description",
      content: "Body text",
      now: later,
    });
    await repository.update(character);

    const persisted = await repository.findById(character.id);

    expect(persisted?.name).toBe("Revised Character");
    expect(persisted?.archetype).toBe("Mentor");
    expect(persisted?.background).toBe("Updated background");
    expect(persisted?.personality).toBe("Stoic");
    expect(persisted?.goal).toBe("New goal");
    expect(persisted?.description).toBe("Updated description");
    expect(persisted?.content).toBe("Body text");
    expect(persisted?.updatedAt).toEqual(expect.any(Date));
  });

  it("persists a status transition through the mapper", async () => {
    const character = createCharacter(characterIds[0], "Draft Character");
    character.updateDetails({
      archetype: "Hero",
      background: "BG",
      personality: "P",
      description: "D",
      now,
    });
    await repository.insert(character);

    character.changeStatus("active", later);
    await repository.update(character);

    const persisted = await repository.findById(character.id);

    expect(persisted?.status).toBe("active");
  });

  it("starts a fresh character at version 0", async () => {
    const character = createCharacter(characterIds[0], "Fresh Character");

    await repository.insert(character);

    const persisted = await repository.findById(character.id);

    expect(persisted?.version).toBe(0);
  });

  it("increments version on each persisted update", async () => {
    const character = createCharacter(characterIds[0], "Draft Character");
    await repository.insert(character);

    const first = await repository.findById(character.id);
    if (!first) throw new Error("test fixture: character missing");
    first.updateDetails({ name: "Revised Once", now: later });
    await repository.update(first);

    const second = await repository.findById(character.id);
    if (!second) throw new Error("test fixture: character missing");
    second.updateDetails({ name: "Revised Twice", now: later });
    await repository.update(second);

    const persisted = await repository.findById(character.id);

    expect(persisted?.version).toBe(2);
  });

  it("rejects update with a stale version as a conflict", async () => {
    const character = createCharacter(characterIds[0], "Draft Character");
    await repository.insert(character);

    const loaded = await repository.findById(character.id);
    if (!loaded) throw new Error("test fixture: character missing");
    expect(loaded.version).toBe(0);

    // A second writer commits first: bump version underneath the stale snapshot.
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    // Re-read at the bumped version, then forge a stale snapshot back at v0.
    const current = await repository.findById(character.id);
    if (!current) throw new Error("test fixture: character missing");
    const staleAtOldVersion = Character.reconstitute({
      ...current.toSnapshot(),
      version: 0,
    });
    staleAtOldVersion.updateDetails({ name: "Lost The Race", now: later });

    await expect(repository.update(staleAtOldVersion)).rejects.toBeInstanceOf(
      CharacterRepositoryConflictError,
    );
  });

  it("deletes a character", async () => {
    const character = createCharacter(characterIds[0], "Disposable Character");
    await repository.insert(character);

    await repository.delete(character.id, character.version);

    const found = await repository.findById(character.id);

    expect(found).toBeNull();
  });

  it("rejects delete with a stale version as a conflict", async () => {
    const character = createCharacter(characterIds[0], "Draft Character");
    await repository.insert(character);

    const loaded = await repository.findById(character.id);
    if (!loaded) throw new Error("test fixture: character missing");
    expect(loaded.version).toBe(0);

    // A second writer commits an edit first: bump version underneath the
    // stale snapshot the delete is about to be issued against.
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    await expect(repository.delete(character.id, 0)).rejects.toBeInstanceOf(
      CharacterRepositoryConflictError,
    );

    // The failed delete must not have removed the row.
    const found = await repository.findById(character.id);
    expect(found).not.toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    const character = createCharacter(characterIds[0], "My Character");
    const duplicate = createCharacter(characterIds[0], "Duplicate Character");

    await repository.insert(character);

    await expect(repository.insert(duplicate)).rejects.toBeInstanceOf(
      CharacterRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const character = createCharacter(characterIds[0], "Ghost Character");

    await expect(repository.update(character)).rejects.toBeInstanceOf(
      CharacterRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(characterIds[0], 0)).rejects.toBeInstanceOf(
      CharacterRepositoryNotFoundError,
    );
  });

  // Character has no parentId/self-hierarchy, so unlike Layer/WorldMap the FK
  // block on delete cannot come from a child pointing back at its parent. It
  // comes from a different source instead:
  // `comment_target_characters_character_id_fkey`
  // (`CommentTargetCharacter.character`, `onDelete: Restrict`). No Domain/
  // repository exists yet for the Feedback domain, so the Comment /
  // CommentTarget / CommentTargetCharacter rows are seeded directly through
  // Prisma, the same way `contentRevision` is seeded elsewhere in this file.
  it("maps deleting a character still targeted by a comment to ReferencedError", async () => {
    const character = createCharacter(characterIds[0], "Commented Character");
    await repository.insert(character);

    await prisma.comment.create({
      data: {
        id: commentId,
        projectId,
        content: "This character needs a better backstory.",
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
    await prisma.commentTargetCharacter.create({
      data: {
        commentTargetId,
        characterId: character.id,
      },
    });

    await expect(
      repository.delete(character.id, character.version),
    ).rejects.toBeInstanceOf(CharacterRepositoryReferencedError);

    // The failed delete must not have removed the row.
    const found = await repository.findById(character.id);
    expect(found).not.toBeNull();
  });
});
