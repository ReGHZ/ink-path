import { Event, type EventProperties } from "../../domain/world/Event.js";

import type {
    Event as PrismaEvent,
    Prisma,
} from "../../../../../generated/prisma/client.js";

export const EventMapper = {
    toDomain(row: PrismaEvent): Event {
        const props: EventProperties = {
            id: row.id,
            version: row.version,
            projectId: row.projectId,
            createdByUserId: row.createdByUserId,
            title: row.title,
            era: row.era,
            timelineOrder: row.timelineOrder,
            eventType: row.eventType,
            significance: row.significance,
            description: row.description,
            content: row.content,
            status: row.status,
            currentRevisionId: row.currentRevisionId ?? "", // Force Entity validation if a required DB value is unexpectedly null.
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };

        return Event.reconstitute(props);
    },

    toPersistence(event: Event): Prisma.EventUncheckedCreateInput {
        const snapshot = event.toSnapshot();

        return {
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
        };
    },

    toCreatePersistence(event: Event): Prisma.EventUncheckedCreateInput {
        return {
            ...this.toPersistence(event),
            currentRevisionId: null,
        };
    },

    // `projectId`/`createdByUserId` are deliberately absent: they are set once
    // at insert and never move, same as every Phase 4 entity.
    toUpdatePersistence(event: Event): Prisma.EventUncheckedUpdateManyInput {
        const snapshot = event.toSnapshot();

        return {
            title: snapshot.title,
            era: snapshot.era,
            timelineOrder: snapshot.timelineOrder,
            eventType: snapshot.eventType,
            significance: snapshot.significance,
            description: snapshot.description,
            content: snapshot.content,
            status: snapshot.status,
            currentRevisionId: snapshot.currentRevisionId,
            updatedAt: snapshot.updatedAt,
            version: { increment: 1 },
        };
    },
};
