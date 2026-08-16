import { describe, expect, it } from "vitest";

import { WorldMapService } from "./WorldMapService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import { WorldMap } from "../../domain/world/WorldMap.js";
import {
  WorldMapRepositoryConflictError,
  WorldMapRepositoryNotFoundError,
  WorldMapRepositoryParentNotFoundError,
  WorldMapRepositoryReferencedError,
} from "../../domain/world/WorldMapRepositoryError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType, ContentRevision } from "../../domain/support/ContentRevision.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";
import type { WorldMapRepository } from "../../domain/world/WorldMapRepository.js";
import type {
  ContentEntityLocation,
  ContentEntityLocator,
} from "../ports/ContentEntityLocator.js";
import type { ContentRepositories, ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

const now = new Date("2026-07-22T00:00:00.000Z");

const writer: ProjectMembership = { role: "writer", canDelete: true };
const editorWithDelete: ProjectMembership = { role: "editor", canDelete: true };
const editorNoDelete: ProjectMembership = { role: "editor", canDelete: false };
const reviewer: ProjectMembership = { role: "reviewer", canDelete: false };

class FakeWorldMapRepository implements WorldMapRepository {
  readonly worldMaps = new Map<string, WorldMap>();

  findById(id: string): Promise<WorldMap | null> {
    return Promise.resolve(this.worldMaps.get(id) ?? null);
  }

  findByProjectId(projectId: string): Promise<WorldMap[]> {
    return Promise.resolve(
      [...this.worldMaps.values()].filter((m) => m.projectId === projectId),
    );
  }

  insert(worldMap: WorldMap): Promise<void> {
    if (this.worldMaps.has(worldMap.id)) {
      return Promise.reject(new WorldMapRepositoryConflictError());
    }
    // Mirrors PrismaWorldMapRepository.insert()'s FK check on `parentId` —
    // the only self-hierarchy reference among WorldMap's raw user input.
    if (worldMap.parentId !== null && !this.worldMaps.has(worldMap.parentId)) {
      return Promise.reject(new WorldMapRepositoryParentNotFoundError());
    }
    this.worldMaps.set(worldMap.id, worldMap);
    return Promise.resolve();
  }

  update(worldMap: WorldMap): Promise<void> {
    // Mirrors PrismaWorldMapRepository.update()'s `version: {increment: 1}`
    // — the passed-in entity is NOT refreshed with the new version, same
    // caveat as the real repository, so bump it here on the stored copy.
    const bumped = WorldMap.reconstitute({
      ...worldMap.toSnapshot(),
      version: worldMap.version + 1,
    });
    this.worldMaps.set(worldMap.id, bumped);
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    const existing = this.worldMaps.get(id);

    if (!existing) {
      return Promise.reject(new WorldMapRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new WorldMapRepositoryConflictError());
    }

    this.worldMaps.delete(id);
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

class FakeContentUnitOfWork implements ContentUnitOfWork<WorldMapRepository> {
  constructor(
    private readonly entity: WorldMapRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
    private readonly contentRelationships: ContentRelationshipRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<WorldMapRepository>,
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
  const worldMaps = new FakeWorldMapRepository();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const idGenerator = new FakeIdGenerator();
  const relationships = new FakeContentRelationshipRepository();
  const locator = new FakeContentEntityLocator();
  const uow = new FakeContentUnitOfWork(
    worldMaps,
    contentRevisions,
    outboxEvents,
    relationships,
  );

  return {
    worldMaps,
    contentRevisions,
    outboxEvents,
    relationships,
    locator,
    service: new WorldMapService(clock, idGenerator, worldMaps, uow, locator),
  };
}

async function seedWorldMap(
  worldMaps: FakeWorldMapRepository,
  overrides: Partial<{ name: string; content: string | null; parentId: string | null }> = {},
): Promise<WorldMap> {
  const worldMap = WorldMap.create({
    id: "map-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    name: overrides.name ?? "The Sundered Continent",
    content: overrides.content ?? null,
    parentId: overrides.parentId ?? null,
    currentRevisionId: "rev-0",
    now,
  });
  await worldMaps.insert(worldMap);
  return worldMap;
}

describe("WorldMapService", () => {
  describe("createWorldMap", () => {
    it("creates the entity and its create revision atomically, returns worldMapId", async () => {
      const { worldMaps, contentRevisions, service } = createService();

      const result = await service.createWorldMap({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        name: "The Sundered Continent",
      });

      expect(result.worldMapId).toBeDefined();
      expect(worldMaps.worldMaps.size).toBe(1);
      expect(contentRevisions.revisions.size).toBe(1);
    });

    // Locks the 2026-08-12 alignment with the Phase 6 services: before it, a
    // DomainError raised while constructing the entity escaped mapWorldMapError
    // and became a raw 500. Unreachable over HTTP (the DTO schema trims and
    // requires min length), but reachable by any non-HTTP caller.
    it("maps a domain validation failure at construction to a 400, not a 500", async () => {
      const { worldMaps, service } = createService();

      await expect(
        service.createWorldMap({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          name: "   ",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

      expect(worldMaps.worldMaps.size).toBe(0);
    });

    it("links the created entity to its own create revision, at version 0", async () => {
      const { worldMaps, service } = createService();

      const result = await service.createWorldMap({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        name: "The Sundered Continent",
      });

      const persisted = worldMaps.worldMaps.get(result.worldMapId);

      expect(persisted?.version).toBe(0);
      expect(persisted?.currentRevisionId).toBeTruthy();
    });

    it("records the create revision with revisionNumber 0, a correct projectId, and an after snapshot", async () => {
      const { contentRevisions, service } = createService();

      await service.createWorldMap({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        name: "The Sundered Continent",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("create");
      expect(revision.revisionNumber).toBe(0);
      expect(revision.afterSnapshot).not.toBeNull();
      expect(revision.beforeSnapshot).toBeNull();
      // Pins the projectId/updatedAt snapshot bugs found in review: the
      // snapshot must record the entity's own projectId (not its id), and
      // updatedAt must be a full ISO timestamp (not a lossy date-only string
      // under a misspelled key).
      expect(revision.afterSnapshot).toMatchObject({
        projectId: "proj-1",
        updatedAt: now.toISOString(),
      });
    });

    it("publishes a content.created outbox event in the same transaction", async () => {
      const { outboxEvents, service } = createService();

      const result = await service.createWorldMap({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        name: "The Sundered Continent",
      });

      expect(outboxEvents.events).toHaveLength(1);
      const event = outboxEvents.events[0];
      expect(event?.eventType).toBe("content.created");
      expect(event?.aggregateType).toBe("map");
      expect(event?.aggregateId).toBe(result.worldMapId);
      expect(event?.routingKey).toBe("content.created");
      expect(event?.exchange).toBe("saas.events");
    });

    it("stores a provided parentId pointing at an existing map", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      const result = await service.createWorldMap({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        parentId: "map-1",
        name: "A Region Within",
      });

      const persisted = worldMaps.worldMaps.get(result.worldMapId);
      expect(persisted?.parentId).toBe("map-1");
    });

    it("maps a dangling parentId to NOT_FOUND", async () => {
      const { service } = createService();

      await expect(
        service.createWorldMap({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          parentId: "missing-parent",
          name: "A Region Within",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Parent world map not found",
      });
    });

    it("maps a parentId belonging to a different project to NOT_FOUND (no cross-tenant leak)", async () => {
      const { worldMaps, service } = createService();
      await worldMaps.insert(
        WorldMap.create({
          id: "map-other-project",
          projectId: "proj-2",
          createdByUserId: "user-1",
          name: "Other Project's Map",
          currentRevisionId: "rev-0",
          now,
        }),
      );

      await expect(
        service.createWorldMap({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          parentId: "map-other-project",
          name: "A Region Within",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Parent world map not found",
      });

      expect(worldMaps.worldMaps.size).toBe(1);
    });

    it("maps a repository-level ParentNotFoundError to NOT_FOUND (TOCTOU backstop)", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);
      worldMaps.insert = (): Promise<void> =>
        Promise.reject(new WorldMapRepositoryParentNotFoundError());

      await expect(
        service.createWorldMap({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          parentId: "map-1",
          name: "A Region Within",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Parent world map not found",
      });
    });

    it("allows an editor (without canDelete) to create", async () => {
      const { service } = createService();

      const result = await service.createWorldMap({
        requestingUserId: "user-1",
        requestingMembership: editorNoDelete,
        projectId: "proj-1",
        name: "The Sundered Continent",
      });

      expect(result.worldMapId).toBeDefined();
    });

    it("throws FORBIDDEN when a reviewer attempts to create", async () => {
      const { worldMaps, service } = createService();

      await expect(
        service.createWorldMap({
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          projectId: "proj-1",
          name: "The Sundered Continent",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(worldMaps.worldMaps.size).toBe(0);
    });

    it("throws FORBIDDEN for a reviewer even with a dangling parentId (authorization runs before the parent check)", async () => {
      const { service } = createService();

      await expect(
        service.createWorldMap({
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          projectId: "proj-1",
          parentId: "missing-parent",
          name: "A Region Within",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
  });

  describe("getWorldMapById", () => {
    it("returns WorldMapDetail with all fields correctly mapped", async () => {
      const { worldMaps, service } = createService();

      const worldMap = WorldMap.create({
        id: "map-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "The Sundered Continent",
        scale: "continent",
        terrain: "mountainous",
        environment: "temperate",
        description: "A fractured landmass",
        currentRevisionId: "rev-1",
        now,
      });
      await worldMaps.insert(worldMap);

      const detail = await service.getWorldMapById("proj-1", "map-1");

      expect(detail).toEqual({
        id: "map-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        parentId: null,
        name: "The Sundered Continent",
        scale: "continent",
        terrain: "mountainous",
        environment: "temperate",
        description: "A fractured landmass",
        content: null,
        status: "draft",
        currentRevisionId: "rev-1",
        createdAt: now,
        updatedAt: now,
      });
    });

    it("does not leak entity internals", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      const detail = await service.getWorldMapById("proj-1", "map-1");

      expect(Object.hasOwn(detail, "props")).toBe(false);
    });

    it("throws NOT_FOUND when the map does not exist", async () => {
      const { service } = createService();

      await expect(
        service.getWorldMapById("proj-1", "missing"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the map belongs to a different project", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.getWorldMapById("proj-2", "map-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("listWorldMapsByProject", () => {
    it("returns only maps belonging to the given project", async () => {
      const { worldMaps, service } = createService();

      await worldMaps.insert(
        WorldMap.create({
          id: "map-1",
          projectId: "proj-1",
          createdByUserId: "user-1",
          name: "In Project 1",
          currentRevisionId: "rev-1",
          now,
        }),
      );
      await worldMaps.insert(
        WorldMap.create({
          id: "map-2",
          projectId: "proj-2",
          createdByUserId: "user-1",
          name: "In Project 2",
          currentRevisionId: "rev-2",
          now,
        }),
      );

      const found = await service.listWorldMapsByProject("proj-1");

      expect(found).toHaveLength(1);
      expect(found[0]?.id).toBe("map-1");
    });

    it("returns an empty array when the project has no maps", async () => {
      const { service } = createService();

      const found = await service.listWorldMapsByProject("proj-1");

      expect(found).toHaveLength(0);
    });
  });

  describe("updateWorldMap", () => {
    it("updates fields and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      const detail = await service.updateWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        name: "Revised Map",
        scale: "region",
      });

      expect(detail.name).toBe("Revised Map");
      expect(detail.scale).toBe("region");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the update, including the new currentRevisionId and bumped version", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      const detail = await service.updateWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        name: "Revised Map",
      });

      const persisted = worldMaps.worldMaps.get("map-1");
      expect(persisted?.name).toBe("Revised Map");
      expect(persisted?.currentRevisionId).toBe(detail.currentRevisionId);
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision with before/after snapshots and revisionNumber = oldVersion + 1", async () => {
      const { worldMaps, contentRevisions, service } = createService();
      await seedWorldMap(worldMaps);

      await service.updateWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        name: "Revised Map",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("update");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({
        name: "The Sundered Continent",
      });
      expect(revision.afterSnapshot).toMatchObject({ name: "Revised Map" });
    });

    it("publishes a content.updated outbox event", async () => {
      const { worldMaps, outboxEvents, service } = createService();
      await seedWorldMap(worldMaps);

      await service.updateWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        name: "Revised Map",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the update is a no-op", async () => {
      const { worldMaps, contentRevisions, outboxEvents, service } = createService();
      await seedWorldMap(worldMaps);

      await service.updateWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        name: "The Sundered Continent",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(worldMaps.worldMaps.get("map-1")?.currentRevisionId).toBe("rev-0");
    });

    it("throws NOT_FOUND when the map does not exist", async () => {
      const { service } = createService();

      await expect(
        service.updateWorldMap("proj-1", "missing", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the map belongs to a different project", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.updateWorldMap("proj-2", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when the new name is blank", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.updateWorldMap("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          name: "   ",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Map name is required",
      });
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when clearing content on a published map", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps, { content: "Body text" });
      await service.changeWorldMapStatus("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "published",
      });

      await expect(
        service.updateWorldMap("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          content: null,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Published map must have content",
      });
    });

    it("maps a repository conflict to CONFLICT", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);
      worldMaps.update = (): Promise<void> =>
        Promise.reject(new WorldMapRepositoryConflictError());

      await expect(
        service.updateWorldMap("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });

    it("allows an editor (without canDelete) to update", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.updateWorldMap("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: editorNoDelete,
          name: "New Name",
        }),
      ).resolves.toMatchObject({ name: "New Name" });
    });

    it("throws FORBIDDEN when a reviewer attempts to update", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.updateWorldMap("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(worldMaps.worldMaps.get("map-1")?.name).toBe(
        "The Sundered Continent",
      );
    });

    it("throws FORBIDDEN for a reviewer even when the map does not exist (authorization runs before entity lookup)", async () => {
      const { service } = createService();

      await expect(
        service.updateWorldMap("proj-1", "missing", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
  });

  describe("changeWorldMapStatus", () => {
    it("changes status and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps, { content: "Body text" });

      const detail = await service.changeWorldMapStatus("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "published",
      });

      expect(detail.status).toBe("published");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the status change, including the bumped version", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps, { content: "Body text" });

      await service.changeWorldMapStatus("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "published",
      });

      const persisted = worldMaps.worldMaps.get("map-1");
      expect(persisted?.status).toBe("published");
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision for the status change, not a separate changeType", async () => {
      const { worldMaps, contentRevisions, service } = createService();
      await seedWorldMap(worldMaps, { content: "Body text" });

      await service.changeWorldMapStatus("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
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
      const { worldMaps, outboxEvents, service } = createService();
      await seedWorldMap(worldMaps, { content: "Body text" });

      await service.changeWorldMapStatus("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "published",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the status is unchanged", async () => {
      const { worldMaps, contentRevisions, outboxEvents, service } = createService();
      await seedWorldMap(worldMaps);

      await service.changeWorldMapStatus("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "draft",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(worldMaps.worldMaps.get("map-1")?.currentRevisionId).toBe("rev-0");
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when publishing without content", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.changeWorldMapStatus("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "published",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Published map must have content",
      });
    });

    it("throws NOT_FOUND when the map does not exist", async () => {
      const { service } = createService();

      await expect(
        service.changeWorldMapStatus("proj-1", "missing", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the map belongs to a different project", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps, { content: "Body text" });

      await expect(
        service.changeWorldMapStatus("proj-2", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws FORBIDDEN when a reviewer attempts to change status", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps, { content: "Body text" });

      await expect(
        service.changeWorldMapStatus("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(worldMaps.worldMaps.get("map-1")?.status).toBe("draft");
    });
  });

  describe("deleteWorldMap", () => {
    // Item 7.4b — Flow 3 §Delete step 5, M:N half. This blocker is invisible to
    // the database: `content_relationships` names its endpoints polymorphically,
    // with no foreign key, so nothing here can come from a P2003.
    it("refuses the delete while a content relationship still points at the world map, and names the blocker", async () => {
      const {
        worldMaps,
        contentRevisions,
        outboxEvents,
        relationships,
        locator,
        service,
      } = createService();
      await seedWorldMap(worldMaps);

      relationships.relationships.push(
        ContentRelationship.create({
          id: "rel-1",
          projectId: "proj-1",
          relationType: "located_in",
          source: { entityType: "character", entityId: "char-9" },
          target: { entityType: "map", entityId: "map-1" },
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
        service.deleteWorldMap("proj-1", "map-1", {
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
              relationType: "located_in",
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
      expect(await worldMaps.findById("map-1")).not.toBeNull();
      expect(contentRevisions.revisions.size).toBe(revisionsBefore);
      expect(outboxEvents.events).toHaveLength(outboxBefore);
    });

    it("deletes the entity", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps, { name: "Disposable Map" });

      await service.deleteWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
      });

      expect(worldMaps.worldMaps.has("map-1")).toBe(false);
    });

    it("records a delete revision with a before snapshot and revisionNumber = version + 1", async () => {
      const { worldMaps, contentRevisions, service } = createService();
      await seedWorldMap(worldMaps, { name: "Disposable Map" });

      await service.deleteWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("delete");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ name: "Disposable Map" });
      expect(revision.afterSnapshot).toBeNull();
    });

    it("publishes a content.deleted outbox event", async () => {
      const { worldMaps, outboxEvents, service } = createService();
      await seedWorldMap(worldMaps);

      await service.deleteWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    it("throws NOT_FOUND when the map does not exist", async () => {
      const { service } = createService();

      await expect(
        service.deleteWorldMap("proj-1", "missing", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the map belongs to a different project", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.deleteWorldMap("proj-2", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("maps a repository referenced error to CONFLICT (map still has a child)", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);
      worldMaps.delete = (): Promise<void> =>
        Promise.reject(new WorldMapRepositoryReferencedError());

      await expect(
        service.deleteWorldMap("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });

    it("allows an editor WITH canDelete to delete", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await service.deleteWorldMap("proj-1", "map-1", {
        requestingUserId: "user-1",
        requestingMembership: editorWithDelete,
      });

      expect(worldMaps.worldMaps.has("map-1")).toBe(false);
    });

    it("throws FORBIDDEN when an editor WITHOUT canDelete attempts to delete", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.deleteWorldMap("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: editorNoDelete,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(worldMaps.worldMaps.has("map-1")).toBe(true);
    });

    it("throws FORBIDDEN when a reviewer attempts to delete", async () => {
      const { worldMaps, service } = createService();
      await seedWorldMap(worldMaps);

      await expect(
        service.deleteWorldMap("proj-1", "map-1", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(worldMaps.worldMaps.has("map-1")).toBe(true);
    });

    it("throws FORBIDDEN for a reviewer even when the map does not exist (authorization runs before entity lookup)", async () => {
      const { service } = createService();

      await expect(
        service.deleteWorldMap("proj-1", "missing", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
  });
});
