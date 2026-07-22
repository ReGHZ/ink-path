import { describe, expect, it } from "vitest";

import { FactionService } from "./FactionService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Faction } from "../../domain/story/Faction.js";
import {
  FactionRepositoryConflictError,
  FactionRepositoryNotFoundError,
} from "../../domain/story/FactionRepositoryError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { FactionRepository } from "../../domain/story/FactionRepository.js";
import type { ContentRevision } from "../../domain/support/ContentRevision.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";
import type { ContentRepositories, ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

const now = new Date("2026-07-20T00:00:00.000Z");

class FakeFactionRepository implements FactionRepository {
  readonly factions = new Map<string, Faction>();

  findById(id: string): Promise<Faction | null> {
    return Promise.resolve(this.factions.get(id) ?? null);
  }

  findByProjectId(projectId: string): Promise<Faction[]> {
    return Promise.resolve(
      [...this.factions.values()].filter((f) => f.projectId === projectId),
    );
  }

  insert(faction: Faction): Promise<void> {
    if (this.factions.has(faction.id)) {
      return Promise.reject(new FactionRepositoryConflictError());
    }
    this.factions.set(faction.id, faction);
    return Promise.resolve();
  }

  update(faction: Faction): Promise<void> {
    // Mirrors PrismaFactionRepository.update()'s `version: {increment: 1}`
    // — the passed-in entity is NOT refreshed with the new version, same
    // caveat as the real repository, so bump it here on the stored copy.
    const bumped = Faction.reconstitute({
      ...faction.toSnapshot(),
      version: faction.version + 1,
    });
    this.factions.set(faction.id, bumped);
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    const existing = this.factions.get(id);

    if (!existing) {
      return Promise.reject(new FactionRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new FactionRepositoryConflictError());
    }

    this.factions.delete(id);
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

class FakeContentUnitOfWork implements ContentUnitOfWork<FactionRepository> {
  constructor(
    private readonly entity: FactionRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<FactionRepository>,
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
  const factions = new FakeFactionRepository();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const idGenerator = new FakeIdGenerator();
  const uow = new FakeContentUnitOfWork(factions, contentRevisions, outboxEvents);

  return {
    factions,
    contentRevisions,
    outboxEvents,
    service: new FactionService(clock, idGenerator, factions, uow),
  };
}

async function seedFaction(
  factions: FakeFactionRepository,
  overrides: Partial<{ name: string; description: string | null; background: string | null }> = {},
): Promise<Faction> {
  const faction = Faction.create({
    id: "faction-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    name: overrides.name ?? "The Cartographers' Guild",
    description: overrides.description ?? null,
    background: overrides.background ?? null,
    currentRevisionId: "rev-0",
    now,
  });
  await factions.insert(faction);
  return faction;
}

describe("FactionService", () => {
  describe("createFaction", () => {
    it("creates the entity and its create revision atomically, returns factionId", async () => {
      const { factions, contentRevisions, service } = createService();

      const result = await service.createFaction({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "The Iron Concord",
      });

      expect(result.factionId).toBeDefined();
      expect(factions.factions.size).toBe(1);
      expect(contentRevisions.revisions.size).toBe(1);
    });

    it("links the created entity to its own create revision, at version 0", async () => {
      const { factions, service } = createService();

      const result = await service.createFaction({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "The Iron Concord",
      });

      const persisted = factions.factions.get(result.factionId);

      expect(persisted?.version).toBe(0);
      expect(persisted?.currentRevisionId).toBeTruthy();
    });

    it("records the create revision with revisionNumber 0 and an after snapshot", async () => {
      const { contentRevisions, service } = createService();

      await service.createFaction({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "The Iron Concord",
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

      const result = await service.createFaction({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "The Iron Concord",
      });

      expect(outboxEvents.events).toHaveLength(1);
      const event = outboxEvents.events[0];
      expect(event?.eventType).toBe("content.created");
      expect(event?.aggregateType).toBe("faction");
      expect(event?.aggregateId).toBe(result.factionId);
      expect(event?.routingKey).toBe("content.created");
      expect(event?.exchange).toBe("saas.events");
    });
  });

  describe("getFactionById", () => {
    it("returns FactionDetail with all fields correctly mapped", async () => {
      const { factions, service } = createService();

      const faction = Faction.create({
        id: "faction-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "The Iron Concord",
        description: "A militant coalition",
        background: "Formed after the war",
        ideology: "Strength through unity",
        size: "large",
        currentRevisionId: "rev-1",
        now,
      });
      await factions.insert(faction);

      const detail = await service.getFactionById("proj-1", "faction-1");

      expect(detail).toEqual({
        id: "faction-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "The Iron Concord",
        description: "A militant coalition",
        background: "Formed after the war",
        ideology: "Strength through unity",
        size: "large",
        content: null,
        status: "draft",
        currentRevisionId: "rev-1",
        createdAt: now,
        updatedAt: now,
      });
    });

    it("does not leak entity internals", async () => {
      const { factions, service } = createService();

      const faction = Faction.create({
        id: "faction-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "The Iron Concord",
        currentRevisionId: "rev-1",
        now,
      });
      await factions.insert(faction);

      const detail = await service.getFactionById("proj-1", "faction-1");

      expect(Object.hasOwn(detail, "props")).toBe(false);
    });

    it("throws NOT_FOUND when the faction does not exist", async () => {
      const { service } = createService();

      await expect(
        service.getFactionById("proj-1", "missing"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the faction belongs to a different project", async () => {
      const { factions, service } = createService();

      const faction = Faction.create({
        id: "faction-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "The Iron Concord",
        currentRevisionId: "rev-1",
        now,
      });
      await factions.insert(faction);

      await expect(
        service.getFactionById("proj-2", "faction-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("listFactionByProject", () => {
    it("returns only factions belonging to the given project", async () => {
      const { factions, service } = createService();

      await factions.insert(
        Faction.create({
          id: "faction-1",
          projectId: "proj-1",
          createdByUserId: "user-1",
          name: "In Project 1",
          currentRevisionId: "rev-1",
          now,
        }),
      );
      await factions.insert(
        Faction.create({
          id: "faction-2",
          projectId: "proj-2",
          createdByUserId: "user-1",
          name: "In Project 2",
          currentRevisionId: "rev-2",
          now,
        }),
      );

      const found = await service.listFactionByProject("proj-1");

      expect(found).toHaveLength(1);
      expect(found[0]?.id).toBe("faction-1");
    });

    it("returns an empty array when the project has no factions", async () => {
      const { service } = createService();

      const found = await service.listFactionByProject("proj-1");

      expect(found).toHaveLength(0);
    });
  });

  describe("updateFaction", () => {
    it("updates fields and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { factions, service } = createService();
      await seedFaction(factions);

      const detail = await service.updateFaction("proj-1", "faction-1", {
        requestingUserId: "user-1",
        name: "The Revised Guild",
        ideology: "New doctrine",
      });

      expect(detail.name).toBe("The Revised Guild");
      expect(detail.ideology).toBe("New doctrine");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the update, including the new currentRevisionId and bumped version", async () => {
      const { factions, service } = createService();
      await seedFaction(factions);

      const detail = await service.updateFaction("proj-1", "faction-1", {
        requestingUserId: "user-1",
        name: "The Revised Guild",
      });

      const persisted = factions.factions.get("faction-1");
      expect(persisted?.name).toBe("The Revised Guild");
      expect(persisted?.currentRevisionId).toBe(detail.currentRevisionId);
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision with before/after snapshots and revisionNumber = oldVersion + 1", async () => {
      const { factions, contentRevisions, service } = createService();
      await seedFaction(factions);

      await service.updateFaction("proj-1", "faction-1", {
        requestingUserId: "user-1",
        name: "The Revised Guild",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("update");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({
        name: "The Cartographers' Guild",
      });
      expect(revision.afterSnapshot).toMatchObject({ name: "The Revised Guild" });
    });

    it("publishes a content.updated outbox event", async () => {
      const { factions, outboxEvents, service } = createService();
      await seedFaction(factions);

      await service.updateFaction("proj-1", "faction-1", {
        requestingUserId: "user-1",
        name: "The Revised Guild",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the update is a no-op", async () => {
      const { factions, contentRevisions, outboxEvents, service } = createService();
      await seedFaction(factions);

      await service.updateFaction("proj-1", "faction-1", {
        requestingUserId: "user-1",
        name: "The Cartographers' Guild",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(factions.factions.get("faction-1")?.currentRevisionId).toBe("rev-0");
    });

    it("throws NOT_FOUND when the faction does not exist", async () => {
      const { service } = createService();

      await expect(
        service.updateFaction("proj-1", "missing", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the faction belongs to a different project", async () => {
      const { factions, service } = createService();
      await seedFaction(factions);

      await expect(
        service.updateFaction("proj-2", "faction-1", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when the new name is blank", async () => {
      const { factions, service } = createService();
      await seedFaction(factions);

      await expect(
        service.updateFaction("proj-1", "faction-1", {
          requestingUserId: "user-1",
          name: "   ",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Faction name is required",
      });
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when clearing a required field on an active faction", async () => {
      const { factions, service } = createService();
      await seedFaction(factions, {
        description: "A guild of mapmakers.",
        background: "Founded after the Sundering.",
      });
      await service.changeFactionStatus("proj-1", "faction-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      await expect(
        service.updateFaction("proj-1", "faction-1", {
          requestingUserId: "user-1",
          description: null,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Active faction must have description",
      });
    });

    it("maps a repository conflict to CONFLICT", async () => {
      const { factions, service } = createService();
      await seedFaction(factions);
      factions.update = (): Promise<void> =>
        Promise.reject(new FactionRepositoryConflictError());

      await expect(
        service.updateFaction("proj-1", "faction-1", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });

  describe("changeFactionStatus", () => {
    it("changes status and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { factions, service } = createService();
      await seedFaction(factions, {
        description: "A guild of mapmakers.",
        background: "Founded after the Sundering.",
      });

      const detail = await service.changeFactionStatus("proj-1", "faction-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      expect(detail.status).toBe("active");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the status change, including the bumped version", async () => {
      const { factions, service } = createService();
      await seedFaction(factions, {
        description: "A guild of mapmakers.",
        background: "Founded after the Sundering.",
      });

      await service.changeFactionStatus("proj-1", "faction-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      const persisted = factions.factions.get("faction-1");
      expect(persisted?.status).toBe("active");
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision for the status change, not a separate changeType", async () => {
      const { factions, contentRevisions, service } = createService();
      await seedFaction(factions, {
        description: "A guild of mapmakers.",
        background: "Founded after the Sundering.",
      });

      await service.changeFactionStatus("proj-1", "faction-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("update");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ status: "draft" });
      expect(revision.afterSnapshot).toMatchObject({ status: "active" });
    });

    it("publishes a content.updated outbox event", async () => {
      const { factions, outboxEvents, service } = createService();
      await seedFaction(factions, {
        description: "A guild of mapmakers.",
        background: "Founded after the Sundering.",
      });

      await service.changeFactionStatus("proj-1", "faction-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the status is unchanged", async () => {
      const { factions, contentRevisions, outboxEvents, service } = createService();
      await seedFaction(factions);

      await service.changeFactionStatus("proj-1", "faction-1", {
        requestingUserId: "user-1",
        status: "draft",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(factions.factions.get("faction-1")?.currentRevisionId).toBe("rev-0");
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when activating without description/background", async () => {
      const { factions, service } = createService();
      await seedFaction(factions);

      await expect(
        service.changeFactionStatus("proj-1", "faction-1", {
          requestingUserId: "user-1",
          status: "active",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Active faction must have description",
      });
    });

    it("throws NOT_FOUND when the faction does not exist", async () => {
      const { service } = createService();

      await expect(
        service.changeFactionStatus("proj-1", "missing", {
          requestingUserId: "user-1",
          status: "active",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the faction belongs to a different project", async () => {
      const { factions, service } = createService();
      await seedFaction(factions, {
        description: "A guild of mapmakers.",
        background: "Founded after the Sundering.",
      });

      await expect(
        service.changeFactionStatus("proj-2", "faction-1", {
          requestingUserId: "user-1",
          status: "active",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("deleteFaction", () => {
    it("deletes the entity", async () => {
      const { factions, service } = createService();
      await seedFaction(factions, { name: "Disposable Faction" });

      await service.deleteFaction("proj-1", "faction-1", {
        requestingUserId: "user-1",
      });

      expect(factions.factions.has("faction-1")).toBe(false);
    });

    it("records a delete revision with a before snapshot and revisionNumber = version + 1", async () => {
      const { factions, contentRevisions, service } = createService();
      await seedFaction(factions, { name: "Disposable Faction" });

      await service.deleteFaction("proj-1", "faction-1", {
        requestingUserId: "user-1",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("delete");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ name: "Disposable Faction" });
      expect(revision.afterSnapshot).toBeNull();
    });

    it("publishes a content.deleted outbox event", async () => {
      const { factions, outboxEvents, service } = createService();
      await seedFaction(factions);

      await service.deleteFaction("proj-1", "faction-1", {
        requestingUserId: "user-1",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    it("throws NOT_FOUND when the faction does not exist", async () => {
      const { service } = createService();

      await expect(
        service.deleteFaction("proj-1", "missing", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the faction belongs to a different project", async () => {
      const { factions, service } = createService();
      await seedFaction(factions);

      await expect(
        service.deleteFaction("proj-2", "faction-1", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("maps a repository referenced error to CONFLICT", async () => {
      const { factions, service } = createService();
      await seedFaction(factions);
      factions.delete = (): Promise<void> =>
        Promise.reject(new FactionRepositoryConflictError());

      await expect(
        service.deleteFaction("proj-1", "faction-1", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });
});
