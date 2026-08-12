import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";
import { Event, type EventStatus } from "../../domain/world/Event.js";
import {
  EventRepositoryConflictError,
  EventRepositoryNotFoundError,
  EventRepositoryReferencedError,
} from "../../domain/world/EventRepositoryError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { EventRepository } from "../../domain/world/EventRepository.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateEventInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  projectId: string;
  title: string;
  era?: string | null;
  timelineOrder?: number | null;
  eventType?: string | null;
  significance?: string | null;
  description?: string | null;
  content?: string | null;
};

export type CreateEventResult = {
  eventId: string;
};

export type EventDetail = {
  id: string;
  projectId: string;
  createdByUserId: string;
  title: string;
  era: string | null;
  timelineOrder: number | null;
  eventType: string | null;
  significance: string | null;
  description: string | null;
  content: string | null;
  status: EventStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChangeEventStatusInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  status: EventStatus;
};

export type UpdateEventInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  title?: string;
  era?: string | null;
  timelineOrder?: number | null;
  eventType?: string | null;
  significance?: string | null;
  description?: string | null;
  content?: string | null;
};

export type DeleteEventInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
};

// Plain, JSON-serializable mirror of EventProperties for
// ContentRevision.afterSnapshot — Prisma's Json column needs JSON-compatible
// values, so Dates go through toISOString() rather than being passed as-is.
function toRevisionSnapshot(event: Event): Record<string, unknown> {
  const snapshot = event.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    title: snapshot.title,
    era: snapshot.era,
    timelineOrder: snapshot.timelineOrder,
    eventType: snapshot.eventType,
    significance: snapshot.significance,
    description: snapshot.description,
    content: snapshot.content,
    status: snapshot.status,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

// Flow 3 Preconditions table (02-system-design/03_flow_03_content_crud.md:14-18):
// Writer = full CRUD, Editor = full CRUD except delete is conditional, Reviewer =
// read-only. Same shape as every Phase 4 service.
function assertCanWrite(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(ErrorCode.FORBIDDEN, "Reviewer role cannot modify events");
  }
}

function assertCanDelete(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(ErrorCode.FORBIDDEN, "Reviewer role cannot delete events");
  }

  if (membership.role === "editor" && !membership.canDelete) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Editor without delete permission cannot delete events",
    );
  }
}

function mapEventError(error: unknown): never {
  if (error instanceof EventRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Event not found");
  }

  if (error instanceof EventRepositoryConflictError) {
    throw new AppError(ErrorCode.CONFLICT, "Event was modified concurrently");
  }

  if (error instanceof EventRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Event is still referenced and cannot be deleted",
    );
  }

  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class EventService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly eventRepository: EventRepository,
    private readonly eventUnitOfWork: ContentUnitOfWork<EventRepository>,
  ) {}

  async createEvent(input: CreateEventInput): Promise<CreateEventResult> {
    assertCanWrite(input.requestingMembership);

    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    // Deliberate divergence from Phase 4: those services call `Entity.create()`
    // OUTSIDE any try/catch, so a DomainError raised at construction (e.g. a
    // title that is whitespace-only) escapes past mapError and reaches
    // errorHandler.ts as a raw 500 — indistinguishable from a real bug. It has
    // never surfaced there only because the Controller's schema validation
    // rejects those inputs first, which makes the service's own behaviour
    // depend on a guarantee from a different layer. Mapped here instead, so a
    // non-HTTP caller (the live-editing checkpoint path, per C2 of
    // `notes/collab-editing-layer-design.md`) gets the same 400-class signal a
    // Controller-driven call would.
    let event: Event;
    try {
      event = Event.create({
        id: this.idGenerator.generate(),
        projectId: input.projectId,
        createdByUserId: input.requestingUserId,
        title: input.title,
        era: input.era,
        timelineOrder: input.timelineOrder,
        eventType: input.eventType,
        significance: input.significance,
        description: input.description,
        content: input.content,
        // Pre-generated so the in-memory entity is domain-valid from the
        // start (policy 06 §4 currentRevisionId decision); the physical row is
        // written without it first — see EventMapper.toCreatePersistence and
        // EventRepository.linkRevision for the DB-side half.
        currentRevisionId: revisionId,
        now,
      });
    } catch (error) {
      mapEventError(error);
    }

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "event",
      entityId: event.id,
      revisionNumber: event.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(event),
      now,
    });

    // No try/catch around the transaction, unlike LayerService.createLayer:
    // `events` has no parent FK, so there is no pre-check that a concurrent
    // delete could invalidate between read and commit. Any error here is a
    // genuine system error, not a domain condition to translate.
    await this.eventUnitOfWork.transaction(async (repositories, outboxEvent) => {
      await repositories.entity.insert(event);
      await repositories.contentRevisions.insert(revision);
      await repositories.entity.linkRevision(event.id, revisionId, event.version);
      await outboxEvent.insert({
        id: this.idGenerator.generate(),
        eventType: "content.created",
        eventVersion: 1,
        aggregateType: "event",
        aggregateId: event.id,
        projectId: event.projectId,
        triggeredByUserId: input.requestingUserId,
        payload: {
          projectId: event.projectId,
          entityType: "event",
          entityId: event.id,
          revisionId,
          revisionNumber: event.version,
          changedByUserId: input.requestingUserId,
        },
        routingKey: "content.created",
        exchange: "saas.events",
      });
    });

    return { eventId: event.id };
  }

  async getEventById(projectId: string, eventId: string): Promise<EventDetail> {
    const event = await this.loadExistingEvent(projectId, eventId);

    return this.toEventDetail(event);
  }

  async listEventsByProject(projectId: string): Promise<EventDetail[]> {
    const events = await this.eventRepository.findByProjectId(projectId);

    return events.map((event) => this.toEventDetail(event));
  }

  async changeEventStatus(
    projectId: string,
    eventId: string,
    input: ChangeEventStatusInput,
  ): Promise<EventDetail> {
    assertCanWrite(input.requestingMembership);

    const event = await this.loadExistingEvent(projectId, eventId);
    const oldVersion = event.version;
    const beforeSnapshot = toRevisionSnapshot(event);

    let changed: boolean;
    try {
      changed = event.changeStatus(input.status, this.clock.now());
    } catch (error) {
      mapEventError(error);
    }

    if (!changed) {
      return this.toEventDetail(event);
    }

    return this.persistChange(
      event,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async updateEvent(
    projectId: string,
    eventId: string,
    input: UpdateEventInput,
  ): Promise<EventDetail> {
    assertCanWrite(input.requestingMembership);

    const event = await this.loadExistingEvent(projectId, eventId);
    const oldVersion = event.version;
    const beforeSnapshot = toRevisionSnapshot(event);

    let changed: boolean;
    try {
      changed = event.updateDetails({
        title: input.title,
        era: input.era,
        timelineOrder: input.timelineOrder,
        eventType: input.eventType,
        significance: input.significance,
        description: input.description,
        content: input.content,
        now: this.clock.now(),
      });
    } catch (error) {
      mapEventError(error);
    }

    if (!changed) {
      return this.toEventDetail(event);
    }

    return this.persistChange(
      event,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async deleteEvent(
    projectId: string,
    eventId: string,
    input: DeleteEventInput,
  ): Promise<void> {
    assertCanDelete(input.requestingMembership);

    const event = await this.loadExistingEvent(projectId, eventId);
    const now = this.clock.now();

    const revisionId = this.idGenerator.generate();
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "event",
      entityId: event.id,
      revisionNumber: event.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(event),
      now,
    });

    try {
      await this.eventUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "event",
            aggregateId: event.id,
            projectId: event.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: event.projectId,
              entityType: "event",
              entityId: event.id,
              revisionId,
              revisionNumber: event.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          await repositories.entity.delete(event.id, event.version);
        },
      );
    } catch (error) {
      mapEventError(error);
    }
  }

  private async persistChange(
    event: Event,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<EventDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(event);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: event.projectId,
      entityType: "event",
      entityId: event.id,
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: event.updatedAt,
    });

    const eventToPersist = Event.reconstitute({
      ...event.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.eventUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(eventToPersist);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "event",
            aggregateId: event.id,
            projectId: event.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: event.projectId,
              entityType: "event",
              entityId: event.id,
              revisionId,
              revisionNumber: oldVersion + 1,
              changedByUserId: requestingUserId,
            },
            routingKey: "content.updated",
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapEventError(error);
    }

    return this.toEventDetail(eventToPersist);
  }

  private async loadExistingEvent(
    projectId: string,
    eventId: string,
  ): Promise<Event> {
    const event = await this.eventRepository.findById(eventId);

    // Same NOT_FOUND for "doesn't exist" and "belongs to another project" —
    // never confirm to an unauthorized caller that an id is valid but theirs.
    if (event?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Event not found");
    }

    return event;
  }

  private toEventDetail(event: Event): EventDetail {
    return {
      id: event.id,
      projectId: event.projectId,
      createdByUserId: event.createdByUserId,
      title: event.title,
      era: event.era,
      timelineOrder: event.timelineOrder,
      eventType: event.eventType,
      significance: event.significance,
      description: event.description,
      content: event.content,
      status: event.status,
      currentRevisionId: event.currentRevisionId,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }
}

export function createEventService({
  clock,
  idGenerator,
  eventRepository,
  eventUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  eventRepository: EventRepository;
  eventUnitOfWork: ContentUnitOfWork<EventRepository>;
}): EventService {
  return new EventService(clock, idGenerator, eventRepository, eventUnitOfWork);
}
