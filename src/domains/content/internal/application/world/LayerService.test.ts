import { describe, expect, it } from "vitest";

import { LayerService } from "./LayerService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Layer } from "../../domain/world/Layer.js";
import {
  LayerRepositoryConflictError,
  LayerRepositoryNotFoundError,
  LayerRepositoryParentNotFoundError,
  LayerRepositoryReferencedError,
} from "../../domain/world/LayerRepositoryError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ContentRevision } from "../../domain/support/ContentRevision.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";
import type { LayerRepository } from "../../domain/world/LayerRepository.js";
import type { ContentRepositories, ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

const now = new Date("2026-07-22T00:00:00.000Z");

class FakeLayerRepository implements LayerRepository {
  readonly layers = new Map<string, Layer>();

  findById(id: string): Promise<Layer | null> {
    return Promise.resolve(this.layers.get(id) ?? null);
  }

  findByProjectId(projectId: string): Promise<Layer[]> {
    return Promise.resolve(
      [...this.layers.values()].filter((l) => l.projectId === projectId),
    );
  }

  insert(layer: Layer): Promise<void> {
    if (this.layers.has(layer.id)) {
      return Promise.reject(new LayerRepositoryConflictError());
    }
    // Mirrors PrismaLayerRepository.insert()'s FK check on `parentId` — the
    // only self-hierarchy reference among Layer's raw user input.
    if (layer.parentId !== null && !this.layers.has(layer.parentId)) {
      return Promise.reject(new LayerRepositoryParentNotFoundError());
    }
    this.layers.set(layer.id, layer);
    return Promise.resolve();
  }

  update(layer: Layer): Promise<void> {
    // Mirrors PrismaLayerRepository.update()'s `version: {increment: 1}`
    // — the passed-in entity is NOT refreshed with the new version, same
    // caveat as the real repository, so bump it here on the stored copy.
    const bumped = Layer.reconstitute({
      ...layer.toSnapshot(),
      version: layer.version + 1,
    });
    this.layers.set(layer.id, bumped);
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    const existing = this.layers.get(id);

    if (!existing) {
      return Promise.reject(new LayerRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new LayerRepositoryConflictError());
    }

    this.layers.delete(id);
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

class FakeContentUnitOfWork implements ContentUnitOfWork<LayerRepository> {
  constructor(
    private readonly entity: LayerRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<LayerRepository>,
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
  const layers = new FakeLayerRepository();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const idGenerator = new FakeIdGenerator();
  const uow = new FakeContentUnitOfWork(layers, contentRevisions, outboxEvents);

  return {
    layers,
    contentRevisions,
    outboxEvents,
    service: new LayerService(clock, idGenerator, layers, uow),
  };
}

async function seedLayer(
  layers: FakeLayerRepository,
  overrides: Partial<{ name: string; content: string | null; parentId: string | null }> = {},
): Promise<Layer> {
  const layer = Layer.create({
    id: "layer-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    name: overrides.name ?? "Surface World",
    level: 1,
    exposure: "internal_only",
    content: overrides.content ?? null,
    parentId: overrides.parentId ?? null,
    currentRevisionId: "rev-0",
    now,
  });
  await layers.insert(layer);
  return layer;
}

describe("LayerService", () => {
  describe("createLayer", () => {
    it("creates the entity and its create revision atomically, returns layerId", async () => {
      const { layers, contentRevisions, service } = createService();

      const result = await service.createLayer({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Surface World",
        level: 1,
        exposure: "internal_only",
      });

      expect(result.layerId).toBeDefined();
      expect(layers.layers.size).toBe(1);
      expect(contentRevisions.revisions.size).toBe(1);
    });

    it("links the created entity to its own create revision, at version 0", async () => {
      const { layers, service } = createService();

      const result = await service.createLayer({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Surface World",
        level: 1,
        exposure: "internal_only",
      });

      const persisted = layers.layers.get(result.layerId);

      expect(persisted?.version).toBe(0);
      expect(persisted?.currentRevisionId).toBeTruthy();
    });

    it("records the create revision with revisionNumber 0 and an after snapshot", async () => {
      const { contentRevisions, service } = createService();

      await service.createLayer({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Surface World",
        level: 1,
        exposure: "internal_only",
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

      const result = await service.createLayer({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Surface World",
        level: 1,
        exposure: "internal_only",
      });

      expect(outboxEvents.events).toHaveLength(1);
      const event = outboxEvents.events[0];
      expect(event?.eventType).toBe("content.created");
      expect(event?.aggregateType).toBe("layer");
      expect(event?.aggregateId).toBe(result.layerId);
      expect(event?.routingKey).toBe("content.created");
      expect(event?.exchange).toBe("saas.events");
    });

    it("stores a provided parentId pointing at an existing layer", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      const result = await service.createLayer({
        requestingUserId: "user-1",
        projectId: "proj-1",
        parentId: "layer-1",
        name: "Underworld",
        level: 2,
        exposure: "internal_only",
      });

      const persisted = layers.layers.get(result.layerId);
      expect(persisted?.parentId).toBe("layer-1");
    });

    it("maps a dangling parentId to NOT_FOUND", async () => {
      const { service } = createService();

      await expect(
        service.createLayer({
          requestingUserId: "user-1",
          projectId: "proj-1",
          parentId: "missing-parent",
          name: "Underworld",
          level: 2,
          exposure: "internal_only",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Parent layer not found",
      });
    });

    it("maps a parentId belonging to a different project to NOT_FOUND (no cross-tenant leak)", async () => {
      const { layers, service } = createService();
      await layers.insert(
        Layer.create({
          id: "layer-other-project",
          projectId: "proj-2",
          createdByUserId: "user-1",
          name: "Other Project's Layer",
          level: 1,
          exposure: "internal_only",
          currentRevisionId: "rev-0",
          now,
        }),
      );

      await expect(
        service.createLayer({
          requestingUserId: "user-1",
          projectId: "proj-1",
          parentId: "layer-other-project",
          name: "Underworld",
          level: 2,
          exposure: "internal_only",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Parent layer not found",
      });

      expect(layers.layers.size).toBe(1);
    });

    it("rejects a child level that is not greater than the parent's level", async () => {
      const { layers, service } = createService();
      await seedLayer(layers); // level 1

      await expect(
        service.createLayer({
          requestingUserId: "user-1",
          projectId: "proj-1",
          parentId: "layer-1",
          name: "Same Level Child",
          level: 1,
          exposure: "internal_only",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Layer level must be greater than its parent's level",
      });
    });

    it("maps a repository-level ParentNotFoundError to NOT_FOUND (TOCTOU backstop)", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);
      layers.insert = (): Promise<void> =>
        Promise.reject(new LayerRepositoryParentNotFoundError());

      await expect(
        service.createLayer({
          requestingUserId: "user-1",
          projectId: "proj-1",
          parentId: "layer-1",
          name: "Underworld",
          level: 2,
          exposure: "internal_only",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Parent layer not found",
      });
    });
  });

  describe("getLayerById", () => {
    it("returns LayerDetail with all fields correctly mapped", async () => {
      const { layers, service } = createService();

      const parent = Layer.create({
        id: "layer-parent",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "Parent Layer",
        level: 1,
        exposure: "internal_only",
        currentRevisionId: "rev-0",
        now,
      });
      await layers.insert(parent);

      const layer = Layer.create({
        id: "layer-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        parentId: "layer-parent",
        name: "Underworld",
        level: 2,
        exposure: "character_aware",
        description: "Below the surface",
        currentRevisionId: "rev-1",
        now,
      });
      await layers.insert(layer);

      const detail = await service.getLayerById("proj-1", "layer-1");

      expect(detail).toEqual({
        id: "layer-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        parentId: "layer-parent",
        name: "Underworld",
        level: 2,
        exposure: "character_aware",
        description: "Below the surface",
        content: null,
        status: "draft",
        currentRevisionId: "rev-1",
        createdAt: now,
        updatedAt: now,
      });
    });

    it("does not leak entity internals", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      const detail = await service.getLayerById("proj-1", "layer-1");

      expect(Object.hasOwn(detail, "props")).toBe(false);
    });

    it("throws NOT_FOUND when the layer does not exist", async () => {
      const { service } = createService();

      await expect(
        service.getLayerById("proj-1", "missing"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the layer belongs to a different project", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      await expect(
        service.getLayerById("proj-2", "layer-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("listLayersByProject", () => {
    it("returns only layers belonging to the given project", async () => {
      const { layers, service } = createService();

      await layers.insert(
        Layer.create({
          id: "layer-1",
          projectId: "proj-1",
          createdByUserId: "user-1",
          name: "In Project 1",
          level: 1,
          exposure: "internal_only",
          currentRevisionId: "rev-1",
          now,
        }),
      );
      await layers.insert(
        Layer.create({
          id: "layer-2",
          projectId: "proj-2",
          createdByUserId: "user-1",
          name: "In Project 2",
          level: 1,
          exposure: "internal_only",
          currentRevisionId: "rev-2",
          now,
        }),
      );

      const found = await service.listLayersByProject("proj-1");

      expect(found).toHaveLength(1);
      expect(found[0]?.id).toBe("layer-1");
    });

    it("returns an empty array when the project has no layers", async () => {
      const { service } = createService();

      const found = await service.listLayersByProject("proj-1");

      expect(found).toHaveLength(0);
    });
  });

  describe("updateLayer", () => {
    it("updates fields and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      const detail = await service.updateLayer("proj-1", "layer-1", {
        requestingUserId: "user-1",
        name: "Revised Layer",
        level: 3,
      });

      expect(detail.name).toBe("Revised Layer");
      expect(detail.level).toBe(3);
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the update, including the new currentRevisionId and bumped version", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      const detail = await service.updateLayer("proj-1", "layer-1", {
        requestingUserId: "user-1",
        name: "Revised Layer",
      });

      const persisted = layers.layers.get("layer-1");
      expect(persisted?.name).toBe("Revised Layer");
      expect(persisted?.currentRevisionId).toBe(detail.currentRevisionId);
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision with before/after snapshots and revisionNumber = oldVersion + 1", async () => {
      const { layers, contentRevisions, service } = createService();
      await seedLayer(layers);

      await service.updateLayer("proj-1", "layer-1", {
        requestingUserId: "user-1",
        name: "Revised Layer",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("update");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ name: "Surface World" });
      expect(revision.afterSnapshot).toMatchObject({ name: "Revised Layer" });
    });

    it("publishes a content.updated outbox event", async () => {
      const { layers, outboxEvents, service } = createService();
      await seedLayer(layers);

      await service.updateLayer("proj-1", "layer-1", {
        requestingUserId: "user-1",
        name: "Revised Layer",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the update is a no-op", async () => {
      const { layers, contentRevisions, outboxEvents, service } = createService();
      await seedLayer(layers);

      await service.updateLayer("proj-1", "layer-1", {
        requestingUserId: "user-1",
        name: "Surface World",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(layers.layers.get("layer-1")?.currentRevisionId).toBe("rev-0");
    });

    it("throws NOT_FOUND when the layer does not exist", async () => {
      const { service } = createService();

      await expect(
        service.updateLayer("proj-1", "missing", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the layer belongs to a different project", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      await expect(
        service.updateLayer("proj-2", "layer-1", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when the new name is blank", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      await expect(
        service.updateLayer("proj-1", "layer-1", {
          requestingUserId: "user-1",
          name: "   ",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Layer name is required",
      });
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when clearing content on a published layer", async () => {
      const { layers, service } = createService();
      await seedLayer(layers, { content: "Body text" });
      await service.changeLayerStatus("proj-1", "layer-1", {
        requestingUserId: "user-1",
        status: "published",
      });

      await expect(
        service.updateLayer("proj-1", "layer-1", {
          requestingUserId: "user-1",
          content: null,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Published layer must have content",
      });
    });

    it("maps a repository conflict to CONFLICT", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);
      layers.update = (): Promise<void> =>
        Promise.reject(new LayerRepositoryConflictError());

      await expect(
        service.updateLayer("proj-1", "layer-1", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });

  describe("changeLayerStatus", () => {
    it("changes status and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { layers, service } = createService();
      await seedLayer(layers, { content: "Body text" });

      const detail = await service.changeLayerStatus("proj-1", "layer-1", {
        requestingUserId: "user-1",
        status: "published",
      });

      expect(detail.status).toBe("published");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the status change, including the bumped version", async () => {
      const { layers, service } = createService();
      await seedLayer(layers, { content: "Body text" });

      await service.changeLayerStatus("proj-1", "layer-1", {
        requestingUserId: "user-1",
        status: "published",
      });

      const persisted = layers.layers.get("layer-1");
      expect(persisted?.status).toBe("published");
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision for the status change, not a separate changeType", async () => {
      const { layers, contentRevisions, service } = createService();
      await seedLayer(layers, { content: "Body text" });

      await service.changeLayerStatus("proj-1", "layer-1", {
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
      const { layers, outboxEvents, service } = createService();
      await seedLayer(layers, { content: "Body text" });

      await service.changeLayerStatus("proj-1", "layer-1", {
        requestingUserId: "user-1",
        status: "published",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the status is unchanged", async () => {
      const { layers, contentRevisions, outboxEvents, service } = createService();
      await seedLayer(layers);

      await service.changeLayerStatus("proj-1", "layer-1", {
        requestingUserId: "user-1",
        status: "draft",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(layers.layers.get("layer-1")?.currentRevisionId).toBe("rev-0");
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when publishing without content", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      await expect(
        service.changeLayerStatus("proj-1", "layer-1", {
          requestingUserId: "user-1",
          status: "published",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Published layer must have content",
      });
    });

    it("throws NOT_FOUND when the layer does not exist", async () => {
      const { service } = createService();

      await expect(
        service.changeLayerStatus("proj-1", "missing", {
          requestingUserId: "user-1",
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the layer belongs to a different project", async () => {
      const { layers, service } = createService();
      await seedLayer(layers, { content: "Body text" });

      await expect(
        service.changeLayerStatus("proj-2", "layer-1", {
          requestingUserId: "user-1",
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("deleteLayer", () => {
    it("deletes the entity", async () => {
      const { layers, service } = createService();
      await seedLayer(layers, { name: "Disposable Layer" });

      await service.deleteLayer("proj-1", "layer-1", {
        requestingUserId: "user-1",
      });

      expect(layers.layers.has("layer-1")).toBe(false);
    });

    it("records a delete revision with a before snapshot and revisionNumber = version + 1", async () => {
      const { layers, contentRevisions, service } = createService();
      await seedLayer(layers, { name: "Disposable Layer" });

      await service.deleteLayer("proj-1", "layer-1", {
        requestingUserId: "user-1",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("delete");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ name: "Disposable Layer" });
      expect(revision.afterSnapshot).toBeNull();
    });

    it("publishes a content.deleted outbox event", async () => {
      const { layers, outboxEvents, service } = createService();
      await seedLayer(layers);

      await service.deleteLayer("proj-1", "layer-1", {
        requestingUserId: "user-1",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    it("throws NOT_FOUND when the layer does not exist", async () => {
      const { service } = createService();

      await expect(
        service.deleteLayer("proj-1", "missing", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the layer belongs to a different project", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);

      await expect(
        service.deleteLayer("proj-2", "layer-1", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("maps a repository referenced error to CONFLICT (layer still has a child)", async () => {
      const { layers, service } = createService();
      await seedLayer(layers);
      layers.delete = (): Promise<void> =>
        Promise.reject(new LayerRepositoryReferencedError());

      await expect(
        service.deleteLayer("proj-1", "layer-1", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });
});
