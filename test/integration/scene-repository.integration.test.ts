import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Scene } from "../../src/domains/content/internal/domain/story/Scene.js";
import {
  SceneRepositoryChapterNotFoundError,
  SceneRepositoryConflictError,
  SceneRepositoryNotFoundError,
  SceneRepositoryOrderConflictError,
} from "../../src/domains/content/internal/domain/story/SceneRepositoryError.js";
import { PrismaSceneRepository } from "../../src/domains/content/internal/infrastructure/story/PrismaSceneRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-08-12T00:00:00.000Z");
const later = new Date("2026-08-12T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001401";
const projectId = "00000000-0000-4000-8000-000000001402";
const revisionId = "00000000-0000-4000-8000-000000001403";

const chapterIds = [
  "64646464-0000-4000-8000-000000000101",
  "64646464-0000-4000-8000-000000000102",
];

const sceneIds = [
  "64646464-0000-4000-8000-000000000001",
  "64646464-0000-4000-8000-000000000002",
  "64646464-0000-4000-8000-000000000003",
];

const bogusChapterId = "ffffffff-ffff-ffff-ffff-fffffffffffe";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaSceneRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.scene.deleteMany({ where: { id: { in: sceneIds } } });
  await client.chapter.deleteMany({ where: { id: { in: chapterIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectRevisionAndChapters(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "scene-owner@example.com",
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

  await prisma.contentRevision.create({
    data: {
      id: revisionId,
      projectId,
      entityType: "scene",
      entityId: sceneIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      afterSnapshot: {},
    },
  });

  // Parent chapters are fixtures here, not the subject under test, so they are
  // seeded straight through Prisma rather than through ChapterRepository.
  await prisma.chapter.createMany({
    data: [
      {
        id: chapterIds[0],
        projectId,
        createdByUserId: ownerUserId,
        title: "The Measuring Hall",
        order: 1,
      },
      {
        id: chapterIds[1],
        projectId,
        createdByUserId: ownerUserId,
        title: "The Spirit Vein Tithe",
        order: 2,
      },
    ],
  });
}

function createScene(
  id: string,
  orderInChapter: number,
  overrides: {
    chapterId?: string;
    title?: string | null;
    content?: string | null;
  } = {},
): Scene {
  return Scene.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    chapterId: overrides.chapterId ?? chapterIds[0],
    orderInChapter,
    title: overrides.title ?? null,
    summary: "A disciple kneels before the qi gauge.",
    content: overrides.content ?? null,
    currentRevisionId: revisionId,
    now,
  });
}

async function insertScene(scene: Scene): Promise<void> {
  await repository.insert(scene);
  await prisma.scene.update({
    where: { id: scene.id },
    data: { currentRevisionId: revisionId },
  });
}

describe("PrismaSceneRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectRevisionAndChapters();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a scene by id", async () => {
    const scene = createScene(sceneIds[0], 1, { title: "Before the Gauge" });

    await insertScene(scene);

    const found = await repository.findById(scene.id);

    expect(found?.id).toBe(scene.id);
    expect(found?.title).toBe("Before the Gauge");
    expect(found?.chapterId).toBe(chapterIds[0]);
    expect(found?.orderInChapter).toBe(1);
    expect(found?.summary).toBe("A disciple kneels before the qi gauge.");
    expect(found?.status).toBe("draft");
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("round-trips a null title", async () => {
    const scene = createScene(sceneIds[0], 1);

    await insertScene(scene);

    expect((await repository.findById(scene.id))?.title).toBeNull();
  });

  it("returns null when scene is not found by id", async () => {
    expect(await repository.findById(sceneIds[0])).toBeNull();
  });

  it("finds scenes of a chapter ordered by orderInChapter ascending", async () => {
    // Inserted out of order so an insertion-order result would fail.
    await insertScene(createScene(sceneIds[1], 2, { title: "Second" }));
    await insertScene(createScene(sceneIds[0], 1, { title: "First" }));

    const found = await repository.findByChapterId(projectId, chapterIds[0]);

    expect(found).toHaveLength(2);
    expect(found[0].title).toBe("First");
    expect(found[1].title).toBe("Second");
  });

  it("scopes findByChapterId to the given chapter only", async () => {
    await insertScene(createScene(sceneIds[0], 1, { title: "In Chapter One" }));
    await insertScene(
      createScene(sceneIds[1], 1, {
        chapterId: chapterIds[1],
        title: "In Chapter Two",
      }),
    );

    const found = await repository.findByChapterId(projectId, chapterIds[1]);

    expect(found).toHaveLength(1);
    expect(found[0].title).toBe("In Chapter Two");
  });

  it("returns empty array when chapter has no scenes", async () => {
    expect(await repository.findByChapterId(projectId, chapterIds[0])).toHaveLength(0);
  });

  // Tenant scoping is enforced in the repository, mirroring
  // ContentRevisionRepository.findByEntity: a chapter id from another project
  // yields an empty list rather than that project's scenes. Without the
  // projectId filter this test returns the foreign scene.
  it("returns empty array for a chapter belonging to another project", async () => {
    const otherUserId = "00000000-0000-4000-8000-000000001404";
    const otherProjectId = "00000000-0000-4000-8000-000000001405";
    const otherChapterId = "64646464-0000-4000-8000-000000000103";
    const otherSceneId = "64646464-0000-4000-8000-000000000004";
    const otherRevisionId = "00000000-0000-4000-8000-000000001406";

    await users.insert(
      User.create({
        id: otherUserId,
        email: "scene-owner-2@example.com",
        username: null,
        passwordHash: "hashed-password",
        now,
      }),
    );
    await projects.insert(
      Project.create({
        id: otherProjectId,
        ownerUserId: otherUserId,
        createdByUserId: otherUserId,
        name: "Ash Sect Records",
        now,
      }),
    );
    await prisma.chapter.create({
      data: {
        id: otherChapterId,
        projectId: otherProjectId,
        createdByUserId: otherUserId,
        title: "Foreign Chapter",
        order: 1,
      },
    });
    // The foreign scene must be fully created (revision linked), otherwise the
    // mapper coerces a null current_revision_id into "" and the sanity check
    // below dies in the entity instead of exercising the query.
    await prisma.contentRevision.create({
      data: {
        id: otherRevisionId,
        projectId: otherProjectId,
        entityType: "scene",
        entityId: otherSceneId,
        revisionNumber: 1,
        changedByUserId: otherUserId,
        changeType: "create",
        afterSnapshot: {},
      },
    });
    await prisma.scene.create({
      data: {
        id: otherSceneId,
        projectId: otherProjectId,
        createdByUserId: otherUserId,
        chapterId: otherChapterId,
        orderInChapter: 1,
        currentRevisionId: otherRevisionId,
      },
    });

    try {
      // Sanity check: the foreign scene really is reachable by chapter alone.
      expect(
        await repository.findByChapterId(otherProjectId, otherChapterId),
      ).toHaveLength(1);

      expect(
        await repository.findByChapterId(projectId, otherChapterId),
      ).toHaveLength(0);
    } finally {
      await prisma.scene.deleteMany({ where: { id: otherSceneId } });
      await prisma.contentRevision.deleteMany({ where: { id: otherRevisionId } });
      await prisma.chapter.deleteMany({ where: { id: otherChapterId } });
      await prisma.project.deleteMany({ where: { id: otherProjectId } });
      await prisma.user.deleteMany({ where: { id: otherUserId } });
    }
  });

  it("persists detail updates through the mapper", async () => {
    const scene = createScene(sceneIds[0], 1);
    await insertScene(scene);

    scene.updateDetails({
      title: "The Gauge Cracks",
      summary: "The gauge reads zero, then shatters.",
      content: "Scene body.",
      orderInChapter: 3,
      now: later,
    });
    await repository.update(scene);

    const persisted = await repository.findById(scene.id);

    expect(persisted?.title).toBe("The Gauge Cracks");
    expect(persisted?.summary).toBe("The gauge reads zero, then shatters.");
    expect(persisted?.content).toBe("Scene body.");
    expect(persisted?.orderInChapter).toBe(3);
  });

  it("persists a status transition through the mapper", async () => {
    const scene = createScene(sceneIds[0], 1, { content: "Scene body." });
    await insertScene(scene);

    scene.changeStatus("published", later);
    await repository.update(scene);

    expect((await repository.findById(scene.id))?.status).toBe("published");
  });

  it("starts a fresh scene at version 0 and increments on each update", async () => {
    const scene = createScene(sceneIds[0], 1);
    await insertScene(scene);

    expect((await repository.findById(scene.id))?.version).toBe(0);

    const loaded = await repository.findById(scene.id);
    if (!loaded) throw new Error("test fixture: scene missing");
    loaded.updateDetails({ title: "Revised Scene", now: later });
    await repository.update(loaded);

    expect((await repository.findById(scene.id))?.version).toBe(1);
  });

  it("maps an insert onto a taken order to OrderConflictError, not a plain conflict", async () => {
    await insertScene(createScene(sceneIds[0], 1));

    await expect(insertScene(createScene(sceneIds[1], 1))).rejects.toBeInstanceOf(
      SceneRepositoryOrderConflictError,
    );
  });

  it("maps an update onto a taken order to OrderConflictError", async () => {
    await insertScene(createScene(sceneIds[0], 1));
    await insertScene(createScene(sceneIds[1], 2));

    const loaded = await repository.findById(sceneIds[1]);
    if (!loaded) throw new Error("test fixture: scene missing");
    loaded.updateDetails({ orderInChapter: 1, now: later });

    await expect(repository.update(loaded)).rejects.toBeInstanceOf(
      SceneRepositoryOrderConflictError,
    );

    expect((await repository.findById(sceneIds[1]))?.orderInChapter).toBe(2);
  });

  it("allows the same orderInChapter in a different chapter", async () => {
    await insertScene(createScene(sceneIds[0], 1));
    await insertScene(createScene(sceneIds[1], 1, { chapterId: chapterIds[1] }));

    expect((await repository.findById(sceneIds[1]))?.orderInChapter).toBe(1);
  });

  // Mirrors LayerRepositoryParentNotFoundError: `chapterId` is the one piece of
  // raw user input among the scene's FKs, so its P2003 is translated by
  // constraint name instead of surfacing raw.
  it("maps an insert with a non-existent chapter id to ChapterNotFoundError", async () => {
    const orphan = createScene(sceneIds[0], 1, { chapterId: bogusChapterId });

    await expect(insertScene(orphan)).rejects.toBeInstanceOf(
      SceneRepositoryChapterNotFoundError,
    );
  });

  it("insert() alone persists a null current_revision_id, pending linkRevision", async () => {
    const scene = createScene(sceneIds[0], 1);

    await repository.insert(scene);

    const row = await prisma.scene.findUniqueOrThrow({
      where: { id: scene.id },
      select: { currentRevisionId: true, version: true },
    });

    expect(row.currentRevisionId).toBeNull();
    expect(row.version).toBe(0);
  });

  it("linkRevision sets currentRevisionId without bumping version", async () => {
    const scene = createScene(sceneIds[0], 1);
    await repository.insert(scene);

    await repository.linkRevision(scene.id, revisionId, 0);

    const persisted = await repository.findById(scene.id);

    expect(persisted?.currentRevisionId).toBe(revisionId);
    expect(persisted?.version).toBe(0);
  });

  it("rejects linkRevision with a stale expectedVersion as a conflict", async () => {
    const scene = createScene(sceneIds[0], 1);
    await repository.insert(scene);

    await expect(
      repository.linkRevision(scene.id, revisionId, 1),
    ).rejects.toBeInstanceOf(SceneRepositoryConflictError);
  });

  it("rejects linkRevision called again on an already-linked entity", async () => {
    const scene = createScene(sceneIds[0], 1);
    await repository.insert(scene);
    await repository.linkRevision(scene.id, revisionId, 0);

    await expect(
      repository.linkRevision(scene.id, revisionId, 0),
    ).rejects.toBeInstanceOf(SceneRepositoryConflictError);
  });

  it("maps linkRevision on a missing target to a neutral not-found error", async () => {
    await expect(
      repository.linkRevision(sceneIds[0], revisionId, 0),
    ).rejects.toBeInstanceOf(SceneRepositoryNotFoundError);
  });

  it("rejects update with a stale version as a conflict", async () => {
    const scene = createScene(sceneIds[0], 1);
    await insertScene(scene);

    const loaded = await repository.findById(scene.id);
    if (!loaded) throw new Error("test fixture: scene missing");
    loaded.updateDetails({ title: "Won The Race", now: later });
    await repository.update(loaded);

    const current = await repository.findById(scene.id);
    if (!current) throw new Error("test fixture: scene missing");
    const staleAtOldVersion = Scene.reconstitute({
      ...current.toSnapshot(),
      version: 0,
    });
    staleAtOldVersion.updateDetails({ title: "Lost The Race", now: later });

    await expect(repository.update(staleAtOldVersion)).rejects.toBeInstanceOf(
      SceneRepositoryConflictError,
    );
  });

  it("deletes a scene", async () => {
    const scene = createScene(sceneIds[0], 1);
    await insertScene(scene);

    await repository.delete(scene.id, scene.version);

    expect(await repository.findById(scene.id)).toBeNull();
  });

  it("rejects delete with a stale version as a conflict and leaves the row intact", async () => {
    const scene = createScene(sceneIds[0], 1);
    await insertScene(scene);

    const loaded = await repository.findById(scene.id);
    if (!loaded) throw new Error("test fixture: scene missing");
    loaded.updateDetails({ title: "Won The Race", now: later });
    await repository.update(loaded);

    await expect(repository.delete(scene.id, 0)).rejects.toBeInstanceOf(
      SceneRepositoryConflictError,
    );

    expect(await repository.findById(scene.id)).not.toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    await insertScene(createScene(sceneIds[0], 1));

    // Same id, different order: the collision is the primary key, not the
    // composite order index, so this must NOT surface as an order conflict.
    await expect(insertScene(createScene(sceneIds[0], 2))).rejects.toBeInstanceOf(
      SceneRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const scene = createScene(sceneIds[0], 1);

    await expect(repository.update(scene)).rejects.toBeInstanceOf(
      SceneRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(sceneIds[0], 0)).rejects.toBeInstanceOf(
      SceneRepositoryNotFoundError,
    );
  });
});
