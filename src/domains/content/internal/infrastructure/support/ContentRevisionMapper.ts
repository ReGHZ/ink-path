import {
  Prisma,
  type ContentRevision as PrismaContentRevision,
} from "../../../../../generated/prisma/client.js";
import {
  ContentRevision,
  type ContentRevisionProperties,
} from "../../domain/support/ContentRevision.js";

export const ContentRevisionMapper = {
  toDomain(row: PrismaContentRevision): ContentRevision {
    const props: ContentRevisionProperties = {
      id: row.id,
      projectId: row.projectId,
      entityType: row.entityType,
      entityId: row.entityId,
      revisionNumber: row.revisionNumber,
      changedByUserId: row.changedByUserId,
      changeType: row.changeType,
      summary: row.summary,
      reason: row.reason,
      // Snapshot columns always hold a serialized entity-property object by
      // construction (never a bare JSON scalar/array) — narrowed from
      // Prisma's broader JsonValue union, same trust-by-construction as the
      // outbox payload cast in outboxRepository.ts.
      beforeSnapshot: row.beforeSnapshot as Record<string, unknown> | null,
      afterSnapshot: row.afterSnapshot as Record<string, unknown> | null,
      createdAt: row.createdAt,
    };

    return ContentRevision.reconstitute(props);
  },

  toPersistence(
    contentRevision: ContentRevision,
  ): Prisma.ContentRevisionUncheckedCreateInput {
    const snapshot = contentRevision.toSnapshot();

    return {
      projectId: snapshot.projectId,
      entityType: snapshot.entityType,
      entityId: snapshot.entityId,
      revisionNumber: snapshot.revisionNumber,
      changedByUserId: snapshot.changedByUserId,
      changeType: snapshot.changeType,
      summary: snapshot.summary,
      reason: snapshot.reason,
      // Prisma's nullable-Json write type does not accept plain `null` —
      // it needs the DbNull sentinel to mean "SQL NULL" (as opposed to
      // JsonNull, which would store the literal JSON value `null`). Our
      // "no snapshot" case is SQL NULL, so DbNull is the correct sentinel.
      beforeSnapshot:
        snapshot.beforeSnapshot === null
          ? Prisma.DbNull
          : (snapshot.beforeSnapshot as Prisma.InputJsonValue),
      afterSnapshot:
        snapshot.afterSnapshot === null
          ? Prisma.DbNull
          : (snapshot.afterSnapshot as Prisma.InputJsonValue),
      createdAt: snapshot.createdAt,
    };
  },
};
