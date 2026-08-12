import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Chapter } from "../../src/domains/content/internal/domain/story/Chapter.js";
import {
  ChapterRepositoryConflictError,
  ChapterRepositoryNotFoundError,
  ChapterRepositoryOrderConflictError,
  ChapterRepositoryReferencedError,
} from "../../src/domains/content/internal/domain/story/ChapterRepositoryError.js";
import { PrismaChapterRepository } from "../../src/domains/content/internal/infrastructure/story/PrismaChapterRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-08-12T00:00:00.000Z");
const later = new Date("2026-08-12T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001301";
const projectId = "00000000-0000-4000-8000-000000001302";
const revisionId = "00000000-0000-4000-8000-000000001303";

const chapterIds = [
  "63636363-0000-4000-8000-000000000001",
  "63636363-0000-4000-8000-000000000002",
];

const sceneId = "63636363-0000-4000-8000-000000000101";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaChapterRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  // Scenes first: `scenes.chapter_id` is `onDelete: Restrict`, so a surviving
  // scene would block its chapter's cleanup.
  await client.scene.deleteMany({ where: { id: sceneId } });
  await client.chapter.deleteMany({ where: { id: { in: chapterIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectAndRevision(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "chapter-owner@example.com",
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
      entityType: "chapter",
      entityId: chapterIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      afterSnapshot: {},
    },
  });
}

function createChapter(
  id: string,
  title: string,
  order: number,
  overrides: { summary?: string | null; content?: string | null } = {},
): Chapter {
  return Chapter.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    title,
    order,
    summary: overrides.summary ?? null,
    content: overrides.content ?? null,
    currentRevisionId: revisionId,
    now,
  });
}

async function insertChapter(chapter: Chapter): Promise<void> {
  await repository.insert(chapter);
  await prisma.chapter.update({
    where: { id: chapter.id },
    data: { currentRevisionId: revisionId },
  });
}

describe("PrismaChapterRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectAndRevision();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a chapter by id", async () => {
    const chapter = createChapter(chapterIds[0], "The Measuring Hall", 1, {
      summary: "The disciple's qi is measured for the first time.",
    });

    await insertChapter(chapter);

    const found = await repository.findById(chapter.id);

    expect(found?.id).toBe(chapter.id);
    expect(found?.title).toBe("The Measuring Hall");
    expect(found?.order).toBe(1);
    expect(found?.summary).toBe(
      "The disciple's qi is measured for the first time.",
    );
    expect(found?.status).toBe("outline");
    expect(found?.publishedAt).toBeNull();
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("returns null when chapter is not found by id", async () => {
    expect(await repository.findById(chapterIds[0])).toBeNull();
  });

  // Diverges from the Phase 4 entities on purpose: chapters carry a canonical
  // narrative order, so findByProjectId sorts by `order`, not `updatedAt`.
  it("finds all chapters by project id ordered by order ascending", async () => {
    const second = createChapter(chapterIds[1], "The Spirit Vein Tithe", 2);
    const first = createChapter(chapterIds[0], "The Measuring Hall", 1);

    // Inserted out of order: a naive updatedAt sort would return them reversed.
    await insertChapter(second);
    await insertChapter(first);

    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(2);
    expect(found[0].order).toBe(1);
    expect(found[1].order).toBe(2);
  });

  it("returns empty array when project has no chapters", async () => {
    expect(await repository.findByProjectId(projectId)).toHaveLength(0);
  });

  it("persists detail updates through the mapper", async () => {
    const chapter = createChapter(chapterIds[0], "Untitled", 1);
    await insertChapter(chapter);

    chapter.updateDetails({
      title: "The Measuring Hall",
      order: 4,
      summary: "An outer disciple fails the qi threshold.",
      content: "Chapter body.",
      now: later,
    });
    await repository.update(chapter);

    const persisted = await repository.findById(chapter.id);

    expect(persisted?.title).toBe("The Measuring Hall");
    expect(persisted?.order).toBe(4);
    expect(persisted?.summary).toBe("An outer disciple fails the qi threshold.");
    expect(persisted?.content).toBe("Chapter body.");
  });

  // Flow 5, all five transitions, with publishedAt as the side effect the
  // mapper must carry both ways.
  it("persists the full outline -> draft -> review -> published path and back", async () => {
    const chapter = createChapter(chapterIds[0], "The Measuring Hall", 1, {
      summary: "The threshold test.",
      content: "Chapter body.",
    });
    await insertChapter(chapter);

    chapter.startDrafting(later);
    await repository.update(chapter);
    expect((await repository.findById(chapter.id))?.status).toBe("draft");

    const drafted = await repository.findById(chapter.id);
    if (!drafted) throw new Error("test fixture: chapter missing");
    drafted.submitForReview(later);
    await repository.update(drafted);
    expect((await repository.findById(chapter.id))?.status).toBe("review");

    const reviewed = await repository.findById(chapter.id);
    if (!reviewed) throw new Error("test fixture: chapter missing");
    reviewed.publish(later);
    await repository.update(reviewed);

    const published = await repository.findById(chapter.id);
    expect(published?.status).toBe("published");
    expect(published?.publishedAt).toEqual(later);

    // unpublish() clears publishedAt — the mapper must write the null back,
    // otherwise reconstitute() would reject the row on the next read.
    if (!published) throw new Error("test fixture: chapter missing");
    published.unpublish(later);
    await repository.update(published);

    const unpublished = await repository.findById(chapter.id);
    expect(unpublished?.status).toBe("draft");
    expect(unpublished?.publishedAt).toBeNull();
  });

  it("starts a fresh chapter at version 0 and increments on each update", async () => {
    const chapter = createChapter(chapterIds[0], "Fresh Chapter", 1);
    await insertChapter(chapter);

    expect((await repository.findById(chapter.id))?.version).toBe(0);

    const loaded = await repository.findById(chapter.id);
    if (!loaded) throw new Error("test fixture: chapter missing");
    loaded.updateDetails({ title: "Revised Chapter", now: later });
    await repository.update(loaded);

    expect((await repository.findById(chapter.id))?.version).toBe(1);
  });

  // The distinction Phase 4 never needed: a taken `order` is deterministic and
  // user-fixable, unlike the transient version conflict below it.
  it("maps an insert onto a taken order to OrderConflictError, not a plain conflict", async () => {
    const first = createChapter(chapterIds[0], "The Measuring Hall", 1);
    await insertChapter(first);

    const collides = createChapter(chapterIds[1], "The Spirit Vein Tithe", 1);

    await expect(insertChapter(collides)).rejects.toBeInstanceOf(
      ChapterRepositoryOrderConflictError,
    );
  });

  it("maps an update onto a taken order to OrderConflictError", async () => {
    const first = createChapter(chapterIds[0], "The Measuring Hall", 1);
    const second = createChapter(chapterIds[1], "The Spirit Vein Tithe", 2);
    await insertChapter(first);
    await insertChapter(second);

    const loaded = await repository.findById(second.id);
    if (!loaded) throw new Error("test fixture: chapter missing");
    loaded.updateDetails({ order: 1, now: later });

    await expect(repository.update(loaded)).rejects.toBeInstanceOf(
      ChapterRepositoryOrderConflictError,
    );

    // The rejected update must not have moved the row.
    expect((await repository.findById(second.id))?.order).toBe(2);
  });

  it("allows the same order in a different project", async () => {
    const otherUserId = "00000000-0000-4000-8000-000000001304";
    const otherProjectId = "00000000-0000-4000-8000-000000001305";

    await users.insert(
      User.create({
        id: otherUserId,
        email: "chapter-owner-2@example.com",
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

    try {
      await insertChapter(createChapter(chapterIds[0], "First", 1));

      await repository.insert(
        Chapter.create({
          id: chapterIds[1],
          projectId: otherProjectId,
          createdByUserId: otherUserId,
          title: "Also First",
          order: 1,
          currentRevisionId: revisionId,
          now,
        }),
      );

      // Read the raw row, not findById(): this chapter is deliberately left
      // un-linked (insert() writes a null current_revision_id), and the mapper
      // coerces that null into "" so the entity rejects it. What matters here
      // is only that the second insert was not refused by the unique index.
      const row = await prisma.chapter.findUniqueOrThrow({
        where: { id: chapterIds[1] },
        select: { order: true, projectId: true },
      });
      expect(row.order).toBe(1);
      expect(row.projectId).toBe(otherProjectId);
    } finally {
      await prisma.chapter.deleteMany({ where: { id: { in: chapterIds } } });
      await prisma.project.deleteMany({ where: { id: otherProjectId } });
      await prisma.user.deleteMany({ where: { id: otherUserId } });
    }
  });

  it("insert() alone persists a null current_revision_id, pending linkRevision", async () => {
    const chapter = createChapter(chapterIds[0], "Pending Chapter", 1);

    await repository.insert(chapter);

    const row = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id },
      select: { currentRevisionId: true, version: true },
    });

    expect(row.currentRevisionId).toBeNull();
    expect(row.version).toBe(0);
  });

  it("linkRevision sets currentRevisionId without bumping version", async () => {
    const chapter = createChapter(chapterIds[0], "Newborn Chapter", 1);
    await repository.insert(chapter);

    await repository.linkRevision(chapter.id, revisionId, 0);

    const persisted = await repository.findById(chapter.id);

    expect(persisted?.currentRevisionId).toBe(revisionId);
    expect(persisted?.version).toBe(0);
  });

  it("rejects linkRevision with a stale expectedVersion as a conflict", async () => {
    const chapter = createChapter(chapterIds[0], "Contested Chapter", 1);
    await repository.insert(chapter);

    await expect(
      repository.linkRevision(chapter.id, revisionId, 1),
    ).rejects.toBeInstanceOf(ChapterRepositoryConflictError);
  });

  it("rejects linkRevision called again on an already-linked entity", async () => {
    const chapter = createChapter(chapterIds[0], "Already Linked Chapter", 1);
    await repository.insert(chapter);
    await repository.linkRevision(chapter.id, revisionId, 0);

    await expect(
      repository.linkRevision(chapter.id, revisionId, 0),
    ).rejects.toBeInstanceOf(ChapterRepositoryConflictError);
  });

  it("maps linkRevision on a missing target to a neutral not-found error", async () => {
    await expect(
      repository.linkRevision(chapterIds[0], revisionId, 0),
    ).rejects.toBeInstanceOf(ChapterRepositoryNotFoundError);
  });

  it("rejects update with a stale version as a conflict", async () => {
    const chapter = createChapter(chapterIds[0], "Contested Chapter", 1);
    await insertChapter(chapter);

    const loaded = await repository.findById(chapter.id);
    if (!loaded) throw new Error("test fixture: chapter missing");
    loaded.updateDetails({ title: "Won The Race", now: later });
    await repository.update(loaded);

    const current = await repository.findById(chapter.id);
    if (!current) throw new Error("test fixture: chapter missing");
    const staleAtOldVersion = Chapter.reconstitute({
      ...current.toSnapshot(),
      version: 0,
    });
    staleAtOldVersion.updateDetails({ title: "Lost The Race", now: later });

    await expect(repository.update(staleAtOldVersion)).rejects.toBeInstanceOf(
      ChapterRepositoryConflictError,
    );
  });

  it("deletes a chapter", async () => {
    const chapter = createChapter(chapterIds[0], "Disposable Chapter", 1);
    await insertChapter(chapter);

    await repository.delete(chapter.id, chapter.version);

    expect(await repository.findById(chapter.id)).toBeNull();
  });

  it("rejects delete with a stale version as a conflict and leaves the row intact", async () => {
    const chapter = createChapter(chapterIds[0], "Guarded Chapter", 1);
    await insertChapter(chapter);

    const loaded = await repository.findById(chapter.id);
    if (!loaded) throw new Error("test fixture: chapter missing");
    loaded.updateDetails({ title: "Won The Race", now: later });
    await repository.update(loaded);

    await expect(repository.delete(chapter.id, 0)).rejects.toBeInstanceOf(
      ChapterRepositoryConflictError,
    );

    expect(await repository.findById(chapter.id)).not.toBeNull();
  });

  // Reachable today, unlike the Phase 4 ReferencedError cases which all wait
  // on the Feedback domain: `scenes` already points at `chapters` with
  // Restrict.
  it("maps deleting a chapter that still has scenes to ReferencedError", async () => {
    const chapter = createChapter(chapterIds[0], "Chapter With Scenes", 1);
    await insertChapter(chapter);

    await prisma.scene.create({
      data: {
        id: sceneId,
        projectId,
        createdByUserId: ownerUserId,
        chapterId: chapter.id,
        orderInChapter: 1,
      },
    });

    await expect(
      repository.delete(chapter.id, chapter.version),
    ).rejects.toBeInstanceOf(ChapterRepositoryReferencedError);

    expect(await repository.findById(chapter.id)).not.toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    const chapter = createChapter(chapterIds[0], "Original Chapter", 1);
    const duplicate = createChapter(chapterIds[0], "Duplicate Chapter", 2);

    await insertChapter(chapter);

    await expect(insertChapter(duplicate)).rejects.toBeInstanceOf(
      ChapterRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const chapter = createChapter(chapterIds[0], "Ghost Chapter", 1);

    await expect(repository.update(chapter)).rejects.toBeInstanceOf(
      ChapterRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(chapterIds[0], 0)).rejects.toBeInstanceOf(
      ChapterRepositoryNotFoundError,
    );
  });
});
