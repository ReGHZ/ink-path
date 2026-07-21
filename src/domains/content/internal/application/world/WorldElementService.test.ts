import { describe, expect, it } from "vitest";

import { WorldElementService } from "./WorldElementService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { WorldElement } from "../../domain/world/WorldElement.js";
import {
  WorldElementRepositoryConflictError,
  WorldElementRepositoryNotFoundError,
} from "../../domain/world/WorldElementRepositoryError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ContentRevision } from "../../domain/support/ContentRevision.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";
import type { WorldElementRepository } from "../../domain/world/WorldElementRepository.js";
import type { ContentRepositories, ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

const now = new Date("2026-07-20T00:00:00.000Z");

class FakeWorldElementRepository implements WorldElementRepository {
  readonly worldElements = new Map<string, WorldElement>();

  findById(id: string): Promise<WorldElement | null> {
    return Promise.resolve(this.worldElements.get(id) ?? null);
  }

  findByProjectId(projectId: string): Promise<WorldElement[]> {
    return Promise.resolve(
      [...this.worldElements.values()].filter((w) => w.projectId === projectId),
    );
  }

  insert(worldElement: WorldElement): Promise<void> {
    if (this.worldElements.has(worldElement.id)) {
      return Promise.reject(new WorldElementRepositoryConflictError());
    }
    this.worldElements.set(worldElement.id, worldElement);
    return Promise.resolve();
  }

  update(worldElement: WorldElement): Promise<void> {
    // Mirrors PrismaWorldElementRepository.update()'s `version: {increment: 1}`
    // — the passed-in entity is NOT refreshed with the new version, same
    // caveat as the real repository, so bump it here on the stored copy.
    const bumped = WorldElement.reconstitute({
      ...worldElement.toSnapshot(),
      version: worldElement.version + 1,
    });
    this.worldElements.set(worldElement.id, bumped);
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    const existing = this.worldElements.get(id);

    if (!existing) {
      return Promise.reject(new WorldElementRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new WorldElementRepositoryConflictError());
    }

    this.worldElements.delete(id);
    return Promise.resolve();
  }

  // The domain invariant (currentRevisionId always non-empty on a
  // constructed WorldElement) means the transient "physical null" row that
  // PrismaWorldElementRepository briefly writes between insert() and
  // linkRevision() has no representation as a WorldElement instance at all —
  // proven by the fact that WorldElement.reconstitute() itself rejects an
  // empty currentRevisionId. That circular-dependency mechanic is real-DB
  // behavior, already covered by the integration tests; this in-memory fake
  // only needs to satisfy the interface, so linkRevision() is a no-op here —
  // the entity handed to insert() already carries its final revisionId.
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

class FakeContentUnitOfWork implements ContentUnitOfWork<WorldElementRepository> {
  constructor(
    private readonly entity: WorldElementRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<WorldElementRepository>,
      outboxEvents: OutboxEventRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return work(
      { entity: this.entity, contentRevisions: this.contentRevisions },
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
  const worldElements = new FakeWorldElementRepository();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const idGenerator = new FakeIdGenerator();
  const uow = new FakeContentUnitOfWork(worldElements, contentRevisions, outboxEvents);

  return {
    worldElements,
    contentRevisions,
    outboxEvents,
    service: new WorldElementService(clock, idGenerator, worldElements, uow),
  };
}

async function seedWorldElement(
  worldElements: FakeWorldElementRepository,
  overrides: Partial<{ name: string; content: string | null }> = {},
): Promise<WorldElement> {
  const worldElement = WorldElement.create({
    id: "we-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    name: overrides.name ?? "Draft Setting",
    category: "geography",
    content: overrides.content ?? null,
    currentRevisionId: "rev-0",
    now,
  });
  await worldElements.insert(worldElement);
  return worldElement;
}

describe("WorldElementService", () => {
  describe("createWorldElement", () => {
    it("creates the entity and its create revision atomically, returns worldElementId", async () => {
      const { worldElements, contentRevisions, service } = createService();

      const result = await service.createWorldElement({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Dragon Range",
        category: "geography",
      });

      expect(result.worldElementId).toBeDefined();
      expect(worldElements.worldElements.size).toBe(1);
      expect(contentRevisions.revisions.size).toBe(1);
    });

    it("links the created entity to its own create revision, at version 0", async () => {
      const { worldElements, service } = createService();

      const result = await service.createWorldElement({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Dragon Range",
        category: "geography",
      });

      const persisted = worldElements.worldElements.get(result.worldElementId);

      expect(persisted?.version).toBe(0);
      expect(persisted?.currentRevisionId).toBeTruthy();
    });

    it("records the create revision with revisionNumber 0 and an after snapshot", async () => {
      const { contentRevisions, service } = createService();

      await service.createWorldElement({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Dragon Range",
        category: "geography",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("create");
      expect(revision.revisionNumber).toBe(0);
      expect(revision.afterSnapshot).not.toBeNull();
      expect(revision.beforeSnapshot).toBeNull();
    });

    it("publishes a content.created outbox event in the same transaction", async () => {
      const { outboxEvents, service } = createService();

      const result = await service.createWorldElement({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Dragon Range",
        category: "geography",
      });

      expect(outboxEvents.events).toHaveLength(1);
      const event = outboxEvents.events[0];
      expect(event?.eventType).toBe("content.created");
      expect(event?.aggregateType).toBe("world_element");
      expect(event?.aggregateId).toBe(result.worldElementId);
      expect(event?.routingKey).toBe("content.created");
      expect(event?.exchange).toBe("saas.events");
    });
  });

  describe("getWorldElementById", () => {
    it("returns WorldElementDetail with all fields correctly mapped", async () => {
      const { worldElements, service } = createService();

      const worldElement = WorldElement.create({
        id: "we-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "Dragon Range",
        category: "geography",
        description: "A jagged mountain chain",
        currentRevisionId: "rev-1",
        now,
      });
      await worldElements.insert(worldElement);

      const detail = await service.getWorldElementById("proj-1", "we-1");

      expect(detail).toEqual({
        id: "we-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "Dragon Range",
        description: "A jagged mountain chain",
        category: "geography",
        content: null,
        status: "draft",
        currentRevisionId: "rev-1",
        createdAt: now,
        updatedAt: now,
      });
    });

    it("does not leak entity internals", async () => {
      const { worldElements, service } = createService();

      const worldElement = WorldElement.create({
        id: "we-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "Dragon Range",
        category: "geography",
        currentRevisionId: "rev-1",
        now,
      });
      await worldElements.insert(worldElement);

      const detail = await service.getWorldElementById("proj-1", "we-1");

      expect(Object.hasOwn(detail, "props")).toBe(false);
    });

    it("throws NOT_FOUND when the world element does not exist", async () => {
      const { service } = createService();

      await expect(
        service.getWorldElementById("proj-1", "missing"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the world element belongs to a different project", async () => {
      const { worldElements, service } = createService();

      const worldElement = WorldElement.create({
        id: "we-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "Dragon Range",
        category: "geography",
        currentRevisionId: "rev-1",
        now,
      });
      await worldElements.insert(worldElement);

      await expect(
        service.getWorldElementById("proj-2", "we-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("listWorldElementsByProject", () => {
    it("returns only world elements belonging to the given project", async () => {
      const { worldElements, service } = createService();

      await worldElements.insert(
        WorldElement.create({
          id: "we-1",
          projectId: "proj-1",
          createdByUserId: "user-1",
          name: "In Project 1",
          category: "geography",
          currentRevisionId: "rev-1",
          now,
        }),
      );
      await worldElements.insert(
        WorldElement.create({
          id: "we-2",
          projectId: "proj-2",
          createdByUserId: "user-1",
          name: "In Project 2",
          category: "geography",
          currentRevisionId: "rev-2",
          now,
        }),
      );

      const found = await service.listWorldElementsByProject("proj-1");

      expect(found).toHaveLength(1);
      expect(found[0]?.id).toBe("we-1");
    });

    it("returns an empty array when the project has no world elements", async () => {
      const { service } = createService();

      const found = await service.listWorldElementsByProject("proj-1");

      expect(found).toHaveLength(0);
    });
  });

  describe("updateWorldElement", () => {
    it("updates fields and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements);

      const detail = await service.updateWorldElement("proj-1", "we-1", {
        requestingUserId: "user-1",
        name: "Revised Setting",
        description: "A windswept coastal town",
      });

      expect(detail.name).toBe("Revised Setting");
      expect(detail.description).toBe("A windswept coastal town");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the update, including the new currentRevisionId and bumped version", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements);

      const detail = await service.updateWorldElement("proj-1", "we-1", {
        requestingUserId: "user-1",
        name: "Revised Setting",
      });

      const persisted = worldElements.worldElements.get("we-1");
      expect(persisted?.name).toBe("Revised Setting");
      expect(persisted?.currentRevisionId).toBe(detail.currentRevisionId);
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision with before/after snapshots and revisionNumber = oldVersion + 1", async () => {
      const { worldElements, contentRevisions, service } = createService();
      await seedWorldElement(worldElements);

      await service.updateWorldElement("proj-1", "we-1", {
        requestingUserId: "user-1",
        name: "Revised Setting",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("update");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ name: "Draft Setting" });
      expect(revision.afterSnapshot).toMatchObject({ name: "Revised Setting" });
    });

    it("publishes a content.updated outbox event", async () => {
      const { worldElements, outboxEvents, service } = createService();
      await seedWorldElement(worldElements);

      await service.updateWorldElement("proj-1", "we-1", {
        requestingUserId: "user-1",
        name: "Revised Setting",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the update is a no-op", async () => {
      const { worldElements, contentRevisions, outboxEvents, service } = createService();
      await seedWorldElement(worldElements);

      await service.updateWorldElement("proj-1", "we-1", {
        requestingUserId: "user-1",
        name: "Draft Setting",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(worldElements.worldElements.get("we-1")?.currentRevisionId).toBe("rev-0");
    });

    it("throws NOT_FOUND when the world element does not exist", async () => {
      const { service } = createService();

      await expect(
        service.updateWorldElement("proj-1", "missing", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the world element belongs to a different project", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements);

      await expect(
        service.updateWorldElement("proj-2", "we-1", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when the new name is blank", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements);

      await expect(
        service.updateWorldElement("proj-1", "we-1", {
          requestingUserId: "user-1",
          name: "   ",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "World element name is required",
      });
    });

    it("maps a repository conflict to CONFLICT", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements);
      worldElements.update = (): Promise<void> =>
        Promise.reject(new WorldElementRepositoryConflictError());

      await expect(
        service.updateWorldElement("proj-1", "we-1", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });

  describe("changeWorldElementStatus", () => {
    it("changes status and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements, { content: "Body text" });

      const detail = await service.changeWorldElementStatus("proj-1", "we-1", {
        requestingUserId: "user-1",
        status: "published",
      });

      expect(detail.status).toBe("published");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the status change, including the bumped version", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements, { content: "Body text" });

      await service.changeWorldElementStatus("proj-1", "we-1", {
        requestingUserId: "user-1",
        status: "published",
      });

      const persisted = worldElements.worldElements.get("we-1");
      expect(persisted?.status).toBe("published");
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision for the status change, not a separate changeType", async () => {
      const { worldElements, contentRevisions, service } = createService();
      await seedWorldElement(worldElements, { content: "Body text" });

      await service.changeWorldElementStatus("proj-1", "we-1", {
        requestingUserId: "user-1",
        status: "published",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("update");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ status: "draft" });
      expect(revision.afterSnapshot).toMatchObject({ status: "published" });
    });

    it("publishes a content.updated outbox event", async () => {
      const { worldElements, outboxEvents, service } = createService();
      await seedWorldElement(worldElements, { content: "Body text" });

      await service.changeWorldElementStatus("proj-1", "we-1", {
        requestingUserId: "user-1",
        status: "published",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the status is unchanged", async () => {
      const { worldElements, contentRevisions, outboxEvents, service } =
        createService();
      await seedWorldElement(worldElements, { content: "Body text" });

      await service.changeWorldElementStatus("proj-1", "we-1", {
        requestingUserId: "user-1",
        status: "draft",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(worldElements.worldElements.get("we-1")?.currentRevisionId).toBe(
        "rev-0",
      );
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when publishing without content", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements);

      await expect(
        service.changeWorldElementStatus("proj-1", "we-1", {
          requestingUserId: "user-1",
          status: "published",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Published world element must have content",
      });
    });

    it("throws NOT_FOUND when the world element does not exist", async () => {
      const { service } = createService();

      await expect(
        service.changeWorldElementStatus("proj-1", "missing", {
          requestingUserId: "user-1",
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the world element belongs to a different project", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements, { content: "Body text" });

      await expect(
        service.changeWorldElementStatus("proj-2", "we-1", {
          requestingUserId: "user-1",
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("deleteWorldElement", () => {
    it("deletes the entity", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements, { name: "Disposable Element" });

      await service.deleteWorldElement("proj-1", "we-1", {
        requestingUserId: "user-1",
      });

      expect(worldElements.worldElements.has("we-1")).toBe(false);
    });

    it("records a delete revision with a before snapshot and revisionNumber = version + 1", async () => {
      const { worldElements, contentRevisions, service } = createService();
      await seedWorldElement(worldElements, { name: "Disposable Element" });

      await service.deleteWorldElement("proj-1", "we-1", {
        requestingUserId: "user-1",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("delete");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ name: "Disposable Element" });
      expect(revision.afterSnapshot).toBeNull();
    });

    it("publishes a content.deleted outbox event", async () => {
      const { worldElements, outboxEvents, service } = createService();
      await seedWorldElement(worldElements);

      await service.deleteWorldElement("proj-1", "we-1", {
        requestingUserId: "user-1",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    it("throws NOT_FOUND when the world element does not exist", async () => {
      const { service } = createService();

      await expect(
        service.deleteWorldElement("proj-1", "missing", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the world element belongs to a different project", async () => {
      const { worldElements, service } = createService();
      await seedWorldElement(worldElements);

      await expect(
        service.deleteWorldElement("proj-2", "we-1", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });
});
