import { EventMapper } from "./EventMapper.js";
import {
  isUniqueViolation,
  isForeignKeyViolation,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  EventRepositoryConflictError,
  EventRepositoryNotFoundError,
  EventRepositoryReferencedError,
} from "../../domain/world/EventRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { Event } from "../../domain/world/Event.js";
import type { EventRepository } from "../../domain/world/EventRepository.js";

export type EventDatabase = Pick<PrismaClient, "event">;

// No `extractForeignKeyConstraint` matching here, unlike PrismaLayerRepository:
// `events` has no self-reference and no user-supplied FK at all. Its three FKs
// (`project_id`, `created_by_user_id`, `current_revision_id`) are sourced from
// authorized context or written by this repository itself, so a P2003 on
// insert/update signals a bug in a higher layer and must surface raw with its
// real constraint name rather than be mistranslated into a domain error.
export class PrismaEventRepository implements EventRepository {
  constructor(private readonly client: EventDatabase) { }

  async findById(id: string): Promise<Event | null> {
    const row = await this.client.event.findUnique({
      where: { id },
    });

    return row ? EventMapper.toDomain(row) : null;
  }

  // `updatedAt desc` mirrors Phase 4 rather than sorting by `timelineOrder`:
  // that column is nullable (`content-world.prisma:133`), so it cannot express
  // a total order over a project's events. Timeline-ordered reads are a
  // presentation concern for 6.5 to shape explicitly.
  async findByProjectId(projectId: string): Promise<Event[]> {
    const rows = await this.client.event.findMany({
      where: {
        projectId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return rows.map((row) => EventMapper.toDomain(row));
  }

  async insert(event: Event): Promise<void> {
    try {
      await this.client.event.create({
        data: {
          id: event.id,
          ...EventMapper.toCreatePersistence(event),
        },
      });
    } catch (error) {
      // `events` carries no composite unique index, so the only reachable
      // P2002 is a primary-key collision on a generated UUID.
      if (isUniqueViolation(error)) {
        throw new EventRepositoryConflictError();
      }

      throw error;
    }
  }

  async update(event: Event): Promise<void> {
    const result = await this.client.event.updateMany({
      where: {
        id: event.id,
        version: event.version,
      },
      data: EventMapper.toUpdatePersistence(event),
    });

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.event.findUnique({
      where: { id: event.id },
      select: { id: true },
    });

    if (!existing) {
      throw new EventRepositoryNotFoundError();
    }

    throw new EventRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.event.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      // On delete every P2003 reads the same way: a third row still points
      // here through an `onDelete: Restrict` FK. Same reasoning as
      // PrismaLayerRepository.delete().
      if (isForeignKeyViolation(error)) {
        throw new EventRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.event.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new EventRepositoryNotFoundError();
    }

    throw new EventRepositoryConflictError();
  }

  // Create-flow only (policy 06 §4): sets currentRevisionId after the
  // content_revisions row exists in the same transaction. `currentRevisionId:
  // null` in the WHERE makes it mechanically impossible to call outside the
  // create flow. No version bump — completing create is not a discrete edit,
  // so a freshly created row still reads version === 0.
  async linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void> {
    const result = await this.client.event.updateMany({
      where: {
        id,
        version: expectedVersion,
        currentRevisionId: null,
      },
      data: {
        currentRevisionId: revisionId,
      },
    });

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.event.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new EventRepositoryNotFoundError();
    }

    throw new EventRepositoryConflictError();
  }
}

export function createEventRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): EventRepository {
  return new PrismaEventRepository(prisma);
}
