import { describe, expect, it } from "vitest";

import { EventService } from "./EventService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import { Event } from "../../domain/world/Event.js";
import {
  EventRepositoryConflictError,
  EventRepositoryNotFoundError,
  EventRepositoryReferencedError,
} from "../../domain/world/EventRepositoryError.js";

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
import type { EventRepository } from "../../domain/world/EventRepository.js";
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

class FakeEventRepository implements EventRepository {
  readonly events = new Map<string, Event>();
  referencedOnDelete = false;

  findById(id: string): Promise<Event | null> {
    return Promise.resolve(this.events.get(id) ?? null);
  }

  findByProjectId(projectId: string): Promise<Event[]> {
    return Promise.resolve(
      [...this.events.values()].filter(
        (event) => event.projectId === projectId,
      ),
    );
  }

  insert(event: Event): Promise<void> {
    if (this.events.has(event.id)) {
      return Promise.reject(new EventRepositoryConflictError());
    }
    this.events.set(event.id, event);
    return Promise.resolve();
  }

  update(event: Event): Promise<void> {
    // Mirrors PrismaEventRepository.update()'s `version: {increment: 1}` —
    // the passed-in entity is not refreshed, so bump the stored copy.
    this.events.set(
      event.id,
      Event.reconstitute({ ...event.toSnapshot(), version: event.version + 1 }),
    );
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    if (this.referencedOnDelete) {
      return Promise.reject(new EventRepositoryReferencedError());
    }

    const existing = this.events.get(id);

    if (!existing) {
      return Promise.reject(new EventRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new EventRepositoryConflictError());
    }

    this.events.delete(id);
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

class FakeContentUnitOfWork implements ContentUnitOfWork<EventRepository> {
  constructor(
    private readonly entity: EventRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
    private readonly contentRelationships: ContentRelationshipRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<EventRepository>,
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
  const events = new FakeEventRepository();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const relationships = new FakeContentRelationshipRepository();
  const locator = new FakeContentEntityLocator();
  const uow = new FakeContentUnitOfWork(
    events,
    contentRevisions,
    outboxEvents,
    relationships,
  );

  return {
    events,
    contentRevisions,
    outboxEvents,
    relationships,
    locator,
    service: new EventService(clock, new FakeIdGenerator(), events, uow, locator),
  };
}

async function seedEvent(
  events: FakeEventRepository,
  overrides: Partial<{ title: string; content: string | null }> = {},
): Promise<Event> {
  const event = Event.create({
    id: "event-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    title: overrides.title ?? "Collapse of the Northern Qi Spire",
    era: "Era of the Sundered Meridian",
    content: overrides.content ?? null,
    currentRevisionId: "rev-0",
    now,
  });
  await events.insert(event);
  return event;
}

describe("EventService", () => {
  describe("createEvent", () => {
    it("creates the entity and its create revision, and emits content.created", async () => {
      const { events, contentRevisions, outboxEvents, service } =
        createService();

      const result = await service.createEvent({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        title: "Founding of the Azure Cloud Sect",
      });

      expect(events.events.size).toBe(1);
      expect(contentRevisions.revisions.size).toBe(1);

      const revision = [...contentRevisions.revisions.values()][0];
      expect(revision?.changeType).toBe("create");
      expect(revision?.entityType).toBe("event");
      expect(revision?.revisionNumber).toBe(0);

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.created");
      expect(outboxEvents.events[0]?.aggregateType).toBe("event");
      expect(outboxEvents.events[0]?.aggregateId).toBe(result.eventId);
    });

    it("rejects a reviewer before touching anything", async () => {
      const { events, contentRevisions, service } = createService();

      await expect(
        service.createEvent({
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          projectId: "proj-1",
          title: "Forbidden Record",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(events.events.size).toBe(0);
      expect(contentRevisions.revisions.size).toBe(0);
    });

    // Diverges from Phase 4, which lets a construction-time DomainError escape
    // as a raw 500 because the Controller schema normally filters it first.
    it("maps a domain validation failure at construction to a 400, not a 500", async () => {
      const { service } = createService();

      await expect(
        service.createEvent({
          requestingUserId: "user-1",
          requestingMembership: writer,
          projectId: "proj-1",
          title: "   ",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });
  });

  describe("reads", () => {
    it("hides an event belonging to another project behind 404", async () => {
      const { events, service } = createService();
      await seedEvent(events);

      await expect(
        service.getEventById("other-project", "event-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("lists only the requested project's events", async () => {
      const { events, service } = createService();
      await seedEvent(events);

      expect(await service.listEventsByProject("proj-1")).toHaveLength(1);
      expect(await service.listEventsByProject("other-project")).toHaveLength(
        0,
      );
    });
  });

  describe("updateEvent", () => {
    it("writes an update revision, swaps currentRevisionId, and emits content.updated", async () => {
      const { events, contentRevisions, outboxEvents, service } =
        createService();
      await seedEvent(events);

      const detail = await service.updateEvent("proj-1", "event-1", {
        requestingUserId: "user-2",
        requestingMembership: writer,
        title: "Fall of the Cloudpiercing Terrace",
      });

      expect(detail.title).toBe("Fall of the Cloudpiercing Terrace");
      expect(detail.currentRevisionId).not.toBe("rev-0");

      const revision = [...contentRevisions.revisions.values()][0];
      expect(revision?.changeType).toBe("update");
      expect(revision?.revisionNumber).toBe(1);
      expect(revision?.beforeSnapshot).not.toBeNull();
      expect(revision?.afterSnapshot).not.toBeNull();

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
      expect(outboxEvents.events[0]?.triggeredByUserId).toBe("user-2");
    });

    it("is a no-op when nothing actually changes: no revision, no event", async () => {
      const { events, contentRevisions, outboxEvents, service } =
        createService();
      await seedEvent(events, { title: "Unchanged" });

      const detail = await service.updateEvent("proj-1", "event-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        title: "Unchanged",
      });

      expect(detail.currentRevisionId).toBe("rev-0");
      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
    });

    it("rejects a reviewer", async () => {
      const { events, service } = createService();
      await seedEvent(events);

      await expect(
        service.updateEvent("proj-1", "event-1", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          title: "Nope",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
  });

  describe("changeEventStatus", () => {
    it("publishes an event that has content", async () => {
      const { events, outboxEvents, service } = createService();
      await seedEvent(events, { content: "Full account." });

      const detail = await service.changeEventStatus("proj-1", "event-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "published",
      });

      expect(detail.status).toBe("published");
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("maps the published-needs-content guard to a 400", async () => {
      const { events, contentRevisions, service } = createService();
      await seedEvent(events, { content: null });

      await expect(
        service.changeEventStatus("proj-1", "event-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "published",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

      expect(contentRevisions.revisions.size).toBe(0);
    });

    it("treats a repeated status as a no-op", async () => {
      const { events, contentRevisions, service } = createService();
      await seedEvent(events);

      await service.changeEventStatus("proj-1", "event-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "draft",
      });

      expect(contentRevisions.revisions.size).toBe(0);
    });
  });

  describe("deleteEvent", () => {
    // Item 7.4b — Flow 3 §Delete step 5, M:N half. This blocker is invisible to
    // the database: `content_relationships` names its endpoints polymorphically,
    // with no foreign key, so nothing here can come from a P2003.
    it("refuses the delete while a content relationship still points at the event, and names the blocker", async () => {
      const {
        events,
        contentRevisions,
        outboxEvents,
        relationships,
        locator,
        service,
      } = createService();
      await seedEvent(events);

      relationships.relationships.push(
        ContentRelationship.create({
          id: "rel-1",
          projectId: "proj-1",
          relationType: "participates_in",
          source: { entityType: "character", entityId: "char-9" },
          target: { entityType: "event", entityId: "event-1" },
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
        service.deleteEvent("proj-1", "event-1", {
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
              relationType: "participates_in",
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
      expect(await events.findById("event-1")).not.toBeNull();
      expect(contentRevisions.revisions.size).toBe(revisionsBefore);
      expect(outboxEvents.events).toHaveLength(outboxBefore);
    });

    it("writes the delete revision and event, then removes the row", async () => {
      const { events, contentRevisions, outboxEvents, service } =
        createService();
      await seedEvent(events);

      await service.deleteEvent("proj-1", "event-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
      });

      expect(events.events.size).toBe(0);

      const revision = [...contentRevisions.revisions.values()][0];
      expect(revision?.changeType).toBe("delete");
      expect(revision?.revisionNumber).toBe(1);
      expect(revision?.beforeSnapshot).not.toBeNull();

      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    it("rejects an editor without delete permission", async () => {
      const { events, service } = createService();
      await seedEvent(events);

      await expect(
        service.deleteEvent("proj-1", "event-1", {
          requestingUserId: "user-1",
          requestingMembership: editorNoDelete,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(events.events.size).toBe(1);
    });

    it("maps a still-referenced row to a 409", async () => {
      const { events, service } = createService();
      await seedEvent(events);
      events.referencedOnDelete = true;

      await expect(
        service.deleteEvent("proj-1", "event-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });
});
