import {
  WorldElement,
  type WorldElementProperties,
} from "../../domain/world/WorldElement.js";

import type {
  WorldElement as PrismaWorldElement,
  Prisma,
} from "../../../../../generated/prisma/client.js";

export const WorldElementMapper = {
  toDomain(row: PrismaWorldElement): WorldElement {
    const props: WorldElementProperties = {
      id: row.id,
      version: row.version,
      projectId: row.projectId,
      createdByUserId: row.createdByUserId,
      name: row.name,
      category: row.category,
      description: row.description,
      content: row.content,
      status: row.status,
      currentRevisionId: row.currentRevisionId ?? "", // Force Entity validation if a required DB value is unexpectedly null.
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return WorldElement.reconstitute(props);
  },

  toPersistence(
    worldElement: WorldElement,
  ): Prisma.WorldElementUncheckedCreateInput {
    const snapshot = worldElement.toSnapshot();

    return {
      projectId: snapshot.projectId,
      createdByUserId: snapshot.createdByUserId,
      name: snapshot.name,
      category: snapshot.category,
      description: snapshot.description,
      content: snapshot.content,
      status: snapshot.status,
      currentRevisionId: snapshot.currentRevisionId,
    };
  },

  toUpdatePersistence(
    worldElement: WorldElement,
  ): Prisma.WorldElementUncheckedUpdateManyInput {
    const snapshot = worldElement.toSnapshot();

    return {
      name: snapshot.name,
      category: snapshot.category,
      description: snapshot.description,
      content: snapshot.content,
      status: snapshot.status,
      currentRevisionId: snapshot.currentRevisionId,
      updatedAt: snapshot.updatedAt,
      version: { increment: 1 },
    };
  },
};
