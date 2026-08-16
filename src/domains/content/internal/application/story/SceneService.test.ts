import { describe, expect, it } from "vitest";

import {
  SceneService,
  type ChapterOwnershipReader,
} from "./SceneService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Chapter } from "../../domain/story/Chapter.js";
import { Scene } from "../../domain/story/Scene.js";
import {
  SceneRepositoryChapterNotFoundError,
  SceneRepositoryConflictError,
  SceneRepositoryNotFoundError,
  SceneRepositoryOrderConflictError,
} from "../../domain/story/SceneRepositoryError.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { SceneRepository } from "../../domain/story/SceneRepository.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType, ContentRevision } from "../../domain/support/ContentRevision.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";
import type {
  ContentEntityLocation,
  ContentEntityLocator,
} from "../ports/ContentEntityLocator.js";
import type {
  ContentRepositories,
  ContentUnitOfWork,
} from "../ports/ContentUnitOfWork.js";

const now = new Date("2026-08-12T00:00:00.000Z");

const writer: ProjectMembership = { role: "writer", canDelete: true };
const editorNoDelete: ProjectMembership = { role: "editor", canDelete: false };
const reviewer: ProjectMembership = { role: "reviewer", canDelete: false };

class FakeSceneRepository implements SceneRepository {
  readonly scenes = new Map<string, Scene>();
  orderConflictOnWrite = false;
  chapterMissingOnInsert = false;

  findById(id: string): Promise<Scene | null> {
    return Promise.resolve(this.scenes.get(id) ?? null);
  }

  // Mirrors PrismaSceneRepository: filtered by BOTH columns, so a chapter id
  // from another project cannot pull that project's scenes.
  findByChapterId(projectId: string, chapterId: string): Promise<Scene[]> {
    return Promise.resolve(
      [...this.scenes.values()]
        .filter((s) => s.projectId === projectId && s.chapterId === chapterId)
        .sort((a, b) => a.orderInChapter - b.orderInChapter),
    );
  }

  insert(scene: Scene): Promise<void> {
    if (this.chapterMissingOnInsert) {
      return Promise.reject(new SceneRepositoryChapterNotFoundError());
    }
    if (this.orderConflictOnWrite) {
      return Promise.reject(new SceneRepositoryOrderConflictError());
    }
    if (this.scenes.has(scene.id)) {
      return Promise.reject(new SceneRepositoryConflictError());
    }
    this.scenes.set(scene.id, scene);
    return Promise.resolve();
  }

  update(scene: Scene): Promise<void> {
    if (this.orderConflictOnWrite) {
      return Promise.reject(new SceneRepositoryOrderConflictError());
    }
    this.scenes.set(
      scene.id,
      Scene.reconstitute({ ...scene.toSnapshot(), version: scene.version + 1 }),
    );
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    const existing = this.scenes.get(id);

    if (!existing) {
      return Promise.reject(new SceneRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new SceneRepositoryConflictError());
    }

    this.scenes.delete(id);
    return Promise.resolve();
  }

  linkRevision(): Promise<void> {
    return Promise.resolve();
  }
}

// Implements ChapterOwnershipReader, NOT ChapterRepository: the service is
// only handed `findById`, so the fake cannot offer it more than the real
// wiring does. `seed` is a test affordance, not part of the port.
class FakeChapterReader implements ChapterOwnershipReader {
  readonly chapters = new Map<string, Chapter>();

  findById(id: string): Promise<Chapter | null> {
    return Promise.resolve(this.chapters.get(id) ?? null);
  }

  seed(chapter: Chapter): void {
    this.chapters.set(chapter.id, chapter);
  }
}

class FakeContentRevisionRepository implements ContentRevisionRepository {
  readonly revisions = new Map<string, ContentRevision>();

  findById(id: string): Promise<ContentRevision | null> {
    return Promise.resolve(this.revisions.get(id) ?? null);
  }

  findByEntity(): Promise<ContentRevision[]> {
    return Promise.resolve([...this.revisions.values()]);
  }

  insert(contentRevision: ContentRevision): Promise<void> {
    this.revisions.set(contentRevision.id, contentRevision);
    return Promise.resolve();
  }
}

class FakeOutboxEventRepository implements OutboxEventRepository {
  readonly events: OutboxEvent[] = [];

  insert(event: OutboxEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

// 7.4b: what the M:N delete guard reads, handed to the service through the unit
// of work. Only findByEntity() is implemented with behaviour — the other four
// methods belong to RelationshipService, and answering them here would invent
// conduct no test asserts. Both orientations are matched, exactly like
// PrismaContentRelationshipRepository's OR: the entity under test can sit on
// either end of the row.
class FakeContentRelationshipRepository implements ContentRelationshipRepository {
  readonly relationships: ContentRelationship[] = [];

  findById(): Promise<ContentRelationship | null> {
    return Promise.reject(new Error("findById is not part of the delete guard"));
  }

  findByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRelationship[]> {
    return Promise.resolve(
      this.relationships.filter(
        (relationship) =>
          relationship.projectId === projectId &&
          ((relationship.sourceEntityType === entityType &&
            relationship.sourceEntityId === entityId) ||
            (relationship.targetEntityType === entityType &&
              relationship.targetEntityId === entityId)),
      ),
    );
  }

  insert(): Promise<void> {
    return Promise.reject(new Error("insert is not part of the delete guard"));
  }

  update(): Promise<void> {
    return Promise.reject(new Error("update is not part of the delete guard"));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error("delete is not part of the delete guard"));
  }
}

class FakeContentEntityLocator implements ContentEntityLocator {
  private readonly entities = new Map<string, ContentEntityLocation>();

  seed(
    entityType: ContentEntityType,
    entityId: string,
    location: ContentEntityLocation,
  ): this {
    this.entities.set(`${entityType}:${entityId}`, location);
    return this;
  }

  locate({
    entityType,
    entityId,
  }: {
    entityType: ContentEntityType;
    entityId: string;
  }): Promise<ContentEntityLocation | null> {
    return Promise.resolve(
      this.entities.get(`${entityType}:${entityId}`) ?? null,
    );
  }
}

class FakeContentUnitOfWork implements ContentUnitOfWork<SceneRepository> {
  constructor(
    private readonly entity: SceneRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
    private readonly contentRelationships: ContentRelationshipRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<SceneRepository>,
      outboxEvents: OutboxEventRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return work(
      {
        entity: this.entity,
        contentRevisions: this.contentRevisions,
        contentRelationships: this.contentRelationships,
      },
      this.outboxEvents,
    );
  }
}

class FakeIdGenerator implements IdGenerator {
  private nextId = 1;

  generate(): string {
    const id = `00000000-0000-4000-8000-${String(this.nextId).padStart(12, "0")}`;
    this.nextId += 1;
    return id;
  }
}

const clock: Clock = { now: () => now };

function createService() {
  const scenes = new FakeSceneRepository();
  const chapters = new FakeChapterReader();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const relationships = new FakeContentRelationshipRepository();
  const locator = new FakeContentEntityLocator();
  const uow = new FakeContentUnitOfWork(
    scenes,
    contentRevisions,
    outboxEvents,
    relationships,
  );

  // One chapter in `proj-1`, one in another project — the second exists solely
  // to prove the ownership check is about the project, not about existence.
  chapters.seed(
    Chapter.create({
      id: "chapter-1",
      projectId: "proj-1",
      createdByUserId: "user-1",
      title: "The Measuring Hall",
      order: 1,
      currentRevisionId: "rev-0",
      now,
    }),
  );
  chapters.seed(
    Chapter.create({
      id: "foreign-chapter",
      projectId: "other-project",
      createdByUserId: "user-9",
      title: "Someone Else's Chapter",
      order: 1,
      currentRevisionId: "rev-0",
      now,
    }),
  );

  return {
    scenes,
    chapters,
    contentRevisions,
    outboxEvents,
    relationships,
    locator,
    service: new SceneService(
      clock,
      new FakeIdGenerator(),
      scenes,
      chapters,
      uow,
      locator,
    ),
  };
}

async function seedScene(
  scenes: FakeSceneRepository,
  overrides: Partial<{
    id: string;
    title: string | null;
    orderInChapter: number;
    content: string | null;
  }> = {},
): Promise<Scene> {
  const scene = Scene.create({
    id: overrides.id ?? "scene-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    chapterId: "chapter-1",
    orderInChapter: overrides.orderInChapter ?? 1,
    title: overrides.title ?? "Before the Gauge",
    summary: "A disciple kneels before the qi gauge.",
    content: overrides.content ?? null,
    currentRevisionId: "rev-0",
    now,
  });
  await scenes.insert(scene);
  return scene;
}

describe("SceneService", () => {
  describe("createScene", () => {
    it("creates the scene under its chapter with revision and event", async () => {
      const { scenes, contentRevisions, outboxEvents, service } =
        createService();

      const result = await service.createScene({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        chapterId: "chapter-1",
        orderInChapter: 1,
        title: "Before the Gauge",
      });

      expect(scenes.scenes.get(result.sceneId)?.chapterId).toBe("chapter-1");
      expect([...contentRevisions.revisions.values()][0]?.entityType).toBe(
        "scene",
      );
      expect(outboxEvents.events[0]?.eventType).toBe("content.created");
      expect(outboxEvents.events[0]?.aggregateType).toBe("scene");
    });

    // The pre-check that only the service can do: the FK proves the chapter
    // exists, never that it belongs to this project.
    it("refuses to hang a scene off another project's chapter", async () => {
      const { scenes, contentRevisions, service } = createService();

      await expect(
        service.createScene({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          chapterId: "foreign-chapter",
          orderInChapter: 1,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Chapter not found",
      });

      expect(scenes.scenes.size).toBe(0);
      expect(contentRevisions.revisions.size).toBe(0);
    });

    it("refuses a chapter that does not exist at all, with the same signal", async () => {
      const { service } = createService();

      await expect(
        service.createScene({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          chapterId: "no-such-chapter",
          orderInChapter: 1,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Chapter not found",
      });
    });

    // Backstop for the gap between the pre-check read and the commit: the
    // chapter can be deleted in between, and the FK fires at insert time.
    it("maps a chapter deleted mid-flight to the same 404 as the pre-check", async () => {
      const { scenes, service } = createService();
      scenes.chapterMissingOnInsert = true;

      await expect(
        service.createScene({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          chapterId: "chapter-1",
          orderInChapter: 1,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Chapter not found",
      });
    });

    it("maps a taken orderInChapter to its own 409", async () => {
      const { scenes, service } = createService();
      scenes.orderConflictOnWrite = true;

      await expect(
        service.createScene({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          chapterId: "chapter-1",
          orderInChapter: 1,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: "Another scene in this chapter already uses that order",
      });
    });

    it("rejects a reviewer before reading anything", async () => {
      const { scenes, service } = createService();

      await expect(
        service.createScene({
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          projectId: "proj-1",
          chapterId: "chapter-1",
          orderInChapter: 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(scenes.scenes.size).toBe(0);
    });
  });

  describe("listScenesByChapter", () => {
    it("returns the chapter's scenes in order", async () => {
      const { scenes, service } = createService();
      await seedScene(scenes, { id: "scene-2", orderInChapter: 2, title: "Second" });
      await seedScene(scenes, { id: "scene-1", orderInChapter: 1, title: "First" });

      const list = await service.listScenesByChapter("proj-1", "chapter-1");

      expect(list.map((scene) => scene.title)).toEqual(["First", "Second"]);
    });

    // An empty array would say "this chapter has no scenes", which is a
    // different fact from "this chapter is not yours".
    it("answers 404 for another project's chapter rather than an empty list", async () => {
      const { service } = createService();

      await expect(
        service.listScenesByChapter("proj-1", "foreign-chapter"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("reads and writes on a single scene", () => {
    it("hides a scene from another project behind 404", async () => {
      const { scenes, service } = createService();
      await seedScene(scenes);

      await expect(
        service.getSceneById("other-project", "scene-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("persists an update with its revision and event", async () => {
      const { scenes, contentRevisions, outboxEvents, service } =
        createService();
      await seedScene(scenes);

      const detail = await service.updateScene("proj-1", "scene-1", {
        requestingUserId: "user-2",
        requestingMembership: writer,
        title: "The Gauge Cracks",
        orderInChapter: 3,
      });

      expect(detail.title).toBe("The Gauge Cracks");
      expect(detail.orderInChapter).toBe(3);
      expect(detail.currentRevisionId).not.toBe("rev-0");
      expect([...contentRevisions.revisions.values()][0]?.revisionNumber).toBe(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("is a no-op when nothing changes", async () => {
      const { scenes, contentRevisions, outboxEvents, service } =
        createService();
      await seedScene(scenes);

      await service.updateScene("proj-1", "scene-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        title: "Before the Gauge",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
    });

    it("maps a taken orderInChapter on update to its own 409", async () => {
      const { scenes, service } = createService();
      await seedScene(scenes);
      scenes.orderConflictOnWrite = true;

      await expect(
        service.updateScene("proj-1", "scene-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          orderInChapter: 2,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: "Another scene in this chapter already uses that order",
      });
    });

    it("publishes a scene that has content", async () => {
      const { scenes, service } = createService();
      await seedScene(scenes, { content: "Scene body." });

      const detail = await service.changeSceneStatus("proj-1", "scene-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "published",
      });

      expect(detail.status).toBe("published");
    });

    it("maps the published-needs-content guard to a 400", async () => {
      const { scenes, service } = createService();
      await seedScene(scenes, { content: null });

      await expect(
        service.changeSceneStatus("proj-1", "scene-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });
  });

  describe("deleteScene", () => {
    // Item 7.4b — Flow 3 §Delete step 5, M:N half. This blocker is invisible to
    // the database: `content_relationships` names its endpoints polymorphically,
    // with no foreign key, so nothing here can come from a P2003.
    it("refuses the delete while a content relationship still points at the scene, and names the blocker", async () => {
      const {
        scenes,
        contentRevisions,
        outboxEvents,
        relationships,
        locator,
        service,
      } = createService();
      await seedScene(scenes);

      relationships.relationships.push(
        ContentRelationship.create({
          id: "rel-1",
          projectId: "proj-1",
          relationType: "depicts",
          source: { entityType: "scene", entityId: "scene-1" },
          target: { entityType: "event", entityId: "event-9" },
          createdByUserId: "user-1",
          now,
        }),
      );
      locator.seed("event", "event-9", {
        projectId: "proj-1",
        entityName: "The Sundering",
      });

      const revisionsBefore = contentRevisions.revisions.size;
      const outboxBefore = outboxEvents.events.length;

      await expect(
        service.deleteScene("proj-1", "scene-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        details: {
          blockingRelationshipCount: 1,
          truncated: false,
          blockingRelationships: [
            {
              id: "rel-1",
              relationType: "depicts",
              entityType: "event",
              entityId: "event-9",
              entityName: "The Sundering",
            },
          ],
        },
      });

      // The guard runs BEFORE the revision and the outbox insert. A delete
      // revision written for an entity that still exists would be worse than no
      // guard at all — the audit trail would claim a deletion that never
      // happened, and the embedding worker would drop a live entity's vectors.
      expect(await scenes.findById("scene-1")).not.toBeNull();
      expect(contentRevisions.revisions.size).toBe(revisionsBefore);
      expect(outboxEvents.events).toHaveLength(outboxBefore);
    });

    it("writes the delete revision and event, then removes the row", async () => {
      const { scenes, contentRevisions, outboxEvents, service } =
        createService();
      await seedScene(scenes);

      await service.deleteScene("proj-1", "scene-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
      });

      expect(scenes.scenes.size).toBe(0);
      expect([...contentRevisions.revisions.values()][0]?.changeType).toBe(
        "delete",
      );
      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    it("rejects an editor without delete permission", async () => {
      const { scenes, service } = createService();
      await seedScene(scenes);

      await expect(
        service.deleteScene("proj-1", "scene-1", {
          requestingUserId: "user-1",
          requestingMembership: editorNoDelete,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(scenes.scenes.size).toBe(1);
    });
  });
});
