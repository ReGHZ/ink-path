import { describe, expect, it } from "vitest";

import { ChapterService } from "./ChapterService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Chapter } from "../../domain/story/Chapter.js";
import {
  ChapterRepositoryConflictError,
  ChapterRepositoryNotFoundError,
  ChapterRepositoryOrderConflictError,
  ChapterRepositoryReferencedError,
} from "../../domain/story/ChapterRepositoryError.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import { seededDefinition } from "../../domain/support/relationshipDefinitionSeed.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ChapterRepository } from "../../domain/story/ChapterRepository.js";
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

class FakeChapterRepository implements ChapterRepository {
  readonly chapters = new Map<string, Chapter>();
  referencedOnDelete = false;
  orderConflictOnWrite = false;

  findById(id: string): Promise<Chapter | null> {
    return Promise.resolve(this.chapters.get(id) ?? null);
  }

  findByProjectId(projectId: string): Promise<Chapter[]> {
    return Promise.resolve(
      [...this.chapters.values()]
        .filter((c) => c.projectId === projectId)
        .sort((a, b) => a.order - b.order),
    );
  }

  insert(chapter: Chapter): Promise<void> {
    if (this.orderConflictOnWrite) {
      return Promise.reject(new ChapterRepositoryOrderConflictError());
    }
    if (this.chapters.has(chapter.id)) {
      return Promise.reject(new ChapterRepositoryConflictError());
    }
    this.chapters.set(chapter.id, chapter);
    return Promise.resolve();
  }

  update(chapter: Chapter): Promise<void> {
    if (this.orderConflictOnWrite) {
      return Promise.reject(new ChapterRepositoryOrderConflictError());
    }
    this.chapters.set(
      chapter.id,
      Chapter.reconstitute({
        ...chapter.toSnapshot(),
        version: chapter.version + 1,
      }),
    );
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    if (this.referencedOnDelete) {
      return Promise.reject(new ChapterRepositoryReferencedError());
    }

    const existing = this.chapters.get(id);

    if (!existing) {
      return Promise.reject(new ChapterRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new ChapterRepositoryConflictError());
    }

    this.chapters.delete(id);
    return Promise.resolve();
  }

  linkRevision(): Promise<void> {
    return Promise.resolve();
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

class FakeContentUnitOfWork implements ContentUnitOfWork<ChapterRepository> {
  constructor(
    private readonly entity: ChapterRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
    private readonly contentRelationships: ContentRelationshipRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<ChapterRepository>,
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
  const chapters = new FakeChapterRepository();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const relationships = new FakeContentRelationshipRepository();
  const locator = new FakeContentEntityLocator();
  const uow = new FakeContentUnitOfWork(
    chapters,
    contentRevisions,
    outboxEvents,
    relationships,
  );

  return {
    chapters,
    contentRevisions,
    outboxEvents,
    relationships,
    locator,
    service: new ChapterService(clock, new FakeIdGenerator(), chapters, uow, locator),
  };
}

// Seeds a chapter already at `status`, going through the real transitions so
// the fixture can never be in a state the state machine cannot produce.
async function seedChapter(
  chapters: FakeChapterRepository,
  status: "outline" | "draft" | "review" | "published" = "outline",
): Promise<Chapter> {
  const chapter = Chapter.create({
    id: "chapter-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    title: "The Measuring Hall",
    order: 1,
    summary: "The threshold test.",
    content: "Chapter body.",
    currentRevisionId: "rev-0",
    now,
  });

  if (status !== "outline") {
    chapter.startDrafting(now);
  }
  if (status === "review" || status === "published") {
    chapter.submitForReview(now);
  }
  if (status === "published") {
    chapter.publish(now);
  }

  await chapters.insert(chapter);
  return chapter;
}

describe("ChapterService", () => {
  describe("createChapter", () => {
    it("creates the entity in outline with its create revision and event", async () => {
      const { chapters, contentRevisions, outboxEvents, service } =
        createService();

      const result = await service.createChapter({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        title: "The Measuring Hall",
        order: 1,
      });

      expect(chapters.chapters.get(result.chapterId)?.status).toBe("outline");
      expect([...contentRevisions.revisions.values()][0]?.entityType).toBe(
        "chapter",
      );
      expect(outboxEvents.events[0]?.eventType).toBe("content.created");
    });

    // The condition Phase 4 never had: a composite unique index that a caller
    // can legitimately collide with.
    it("maps a taken order to a 409 with its own message, not the generic conflict", async () => {
      const { service, chapters } = createService();
      chapters.orderConflictOnWrite = true;

      await expect(
        service.createChapter({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          title: "Second Chapter One",
          order: 1,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: "Another chapter in this project already uses that order",
      });
    });

    it("rejects a reviewer", async () => {
      const { service } = createService();

      await expect(
        service.createChapter({
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          projectId: "proj-1",
          title: "Forbidden Chapter",
          order: 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
  });

  describe("changeChapterStatus — the five Flow 5 edges", () => {
    it("outline -> draft requires summary and produces a revision", async () => {
      const { chapters, contentRevisions, outboxEvents, service } =
        createService();
      await seedChapter(chapters, "outline");

      const detail = await service.changeChapterStatus("proj-1", "chapter-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "draft",
      });

      expect(detail.status).toBe("draft");
      expect([...contentRevisions.revisions.values()][0]?.changeType).toBe(
        "update",
      );
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("draft -> review", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "draft");

      const detail = await service.changeChapterStatus("proj-1", "chapter-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "review",
      });

      expect(detail.status).toBe("review");
    });

    it("review -> published sets publishedAt", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "review");

      const detail = await service.changeChapterStatus("proj-1", "chapter-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "published",
      });

      expect(detail.status).toBe("published");
      expect(detail.publishedAt).toEqual(now);
    });

    // Both backward edges land on `draft`, which is exactly why the dispatch
    // is on the (origin, target) pair rather than the target alone.
    it("review -> draft is a revision request, keeping publishedAt null", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "review");

      const detail = await service.changeChapterStatus("proj-1", "chapter-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "draft",
      });

      expect(detail.status).toBe("draft");
      expect(detail.publishedAt).toBeNull();
    });

    it("published -> draft is an unpublish, clearing publishedAt", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "published");

      const detail = await service.changeChapterStatus("proj-1", "chapter-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "draft",
      });

      expect(detail.status).toBe("draft");
      expect(detail.publishedAt).toBeNull();
    });

    it("rejects a jump that is not an edge of the state machine", async () => {
      const { chapters, contentRevisions, service } = createService();
      await seedChapter(chapters, "outline");

      await expect(
        service.changeChapterStatus("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "published",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Cannot transition chapter from outline to published",
      });

      expect(contentRevisions.revisions.size).toBe(0);
    });

    // Deliberately different from Event/Plot/Scene, whose changeStatus() treats
    // a repeated status as a harmless no-op: Flow 5 requires a specific origin
    // for every edge, and draft -> draft is not one of them.
    it("rejects a same-status request instead of treating it as a no-op", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "draft");

      await expect(
        service.changeChapterStatus("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "draft",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Cannot transition chapter from draft to draft",
      });
    });

    it("rejects nothing-leads-back-into-outline", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "draft");

      await expect(
        service.changeChapterStatus("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "outline",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it("rejects a reviewer on every transition (Flow 5 permission table)", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "outline");

      await expect(
        service.changeChapterStatus("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          status: "draft",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it("hides a chapter from another project behind 404", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "outline");

      await expect(
        service.changeChapterStatus("other-project", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "draft",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("startDrafting guard", () => {
    it("maps a missing summary to a 400", async () => {
      const { chapters, service } = createService();
      const chapter = Chapter.create({
        id: "chapter-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        title: "No Summary Yet",
        order: 1,
        currentRevisionId: "rev-0",
        now,
      });
      await chapters.insert(chapter);

      await expect(
        service.changeChapterStatus("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "draft",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });
  });

  describe("updateChapter", () => {
    it("edits an outline chapter and writes an update revision", async () => {
      const { chapters, contentRevisions, service } = createService();
      await seedChapter(chapters, "outline");

      const detail = await service.updateChapter("proj-1", "chapter-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        title: "The Gauge Room",
      });

      expect(detail.title).toBe("The Gauge Room");
      expect([...contentRevisions.revisions.values()][0]?.revisionNumber).toBe(1);
    });

    // Flow 5's "all editing happens in draft" is enforced by the entity, and
    // the service must surface it as a 400 rather than a 500.
    it("refuses to edit while in review", async () => {
      const { chapters, contentRevisions, service } = createService();
      await seedChapter(chapters, "review");

      await expect(
        service.updateChapter("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          title: "Sneaky Edit",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

      expect(contentRevisions.revisions.size).toBe(0);
    });

    it("refuses to edit while published", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "published");

      await expect(
        service.updateChapter("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          content: "Sneaky Edit",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it("maps a taken order on update to the order-specific 409", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "outline");
      chapters.orderConflictOnWrite = true;

      await expect(
        service.updateChapter("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          order: 2,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: "Another chapter in this project already uses that order",
      });
    });

    it("is a no-op when nothing changes", async () => {
      const { chapters, contentRevisions, outboxEvents, service } =
        createService();
      await seedChapter(chapters, "outline");

      await service.updateChapter("proj-1", "chapter-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        title: "The Measuring Hall",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
    });
  });

  describe("listChaptersByProject", () => {
    it("returns chapters in narrative order", async () => {
      const { chapters, service } = createService();
      await chapters.insert(
        Chapter.create({
          id: "chapter-2",
          projectId: "proj-1",
          createdByUserId: "user-1",
          title: "Second",
          order: 2,
          currentRevisionId: "rev-0",
          now,
        }),
      );
      await seedChapter(chapters, "outline");

      const list = await service.listChaptersByProject("proj-1");

      expect(list.map((chapter) => chapter.order)).toEqual([1, 2]);
    });
  });

  describe("deleteChapter", () => {
    // Item 7.4b — Flow 3 §Delete step 5, M:N half. This blocker is invisible to
    // the database: `content_relationships` names its endpoints polymorphically,
    // with no foreign key, so nothing here can come from a P2003.
    it("refuses the delete while a content relationship still points at the chapter, and names the blocker", async () => {
      const {
        chapters,
        contentRevisions,
        outboxEvents,
        relationships,
        locator,
        service,
      } = createService();
      await seedChapter(chapters);

      relationships.relationships.push(
        ContentRelationship.create({
          id: "rel-1",
          projectId: "proj-1",
          relationType: "appears_in",
          definition: seededDefinition("appears_in"),
          source: { entityType: "character", entityId: "char-9" },
          target: { entityType: "chapter", entityId: "chapter-1" },
          sourceAssertionId: "assertion-1",
          createdByUserId: "user-1",
          now,
        }),
      );
      locator.seed("character", "char-9", {
        projectId: "proj-1",
        entityName: "Kael of Vael",
      });

      const revisionsBefore = contentRevisions.revisions.size;
      const outboxBefore = outboxEvents.events.length;

      await expect(
        service.deleteChapter("proj-1", "chapter-1", {
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
              relationType: "appears_in",
              entityType: "character",
              entityId: "char-9",
              entityName: "Kael of Vael",
            },
          ],
        },
      });

      // The guard runs BEFORE the revision and the outbox insert. A delete
      // revision written for an entity that still exists would be worse than no
      // guard at all — the audit trail would claim a deletion that never
      // happened, and the embedding worker would drop a live entity's vectors.
      expect(await chapters.findById("chapter-1")).not.toBeNull();
      expect(contentRevisions.revisions.size).toBe(revisionsBefore);
      expect(outboxEvents.events).toHaveLength(outboxBefore);
    });

    it("writes the delete revision and event, then removes the row", async () => {
      const { chapters, contentRevisions, outboxEvents, service } =
        createService();
      await seedChapter(chapters, "outline");

      await service.deleteChapter("proj-1", "chapter-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
      });

      expect(chapters.chapters.size).toBe(0);
      expect([...contentRevisions.revisions.values()][0]?.changeType).toBe(
        "delete",
      );
      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    // Reachable today: scenes point at chapters with onDelete: Restrict.
    it("maps a chapter that still has scenes to a 409 naming the reason", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "outline");
      chapters.referencedOnDelete = true;

      await expect(
        service.deleteChapter("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: "Chapter still has scenes and cannot be deleted",
      });
    });

    it("rejects an editor without delete permission", async () => {
      const { chapters, service } = createService();
      await seedChapter(chapters, "outline");

      await expect(
        service.deleteChapter("proj-1", "chapter-1", {
          requestingUserId: "user-1",
          requestingMembership: editorNoDelete,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(chapters.chapters.size).toBe(1);
    });
  });
});
