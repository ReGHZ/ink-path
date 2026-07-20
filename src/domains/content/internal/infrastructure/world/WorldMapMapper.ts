import {
  WorldMap,
  type WorldMapProperties,
} from "../../domain/world/WorldMap.js";

import type {
  Map as PrismaWorldMap,
  Prisma,
} from "../../../../../generated/prisma/client.js";

export const WorldMapMapper = {
  toDomain(row: PrismaWorldMap): WorldMap {
    const props: WorldMapProperties = {
      id: row.id,
      version: row.version,
      projectId: row.projectId,
      createdByUserId: row.createdByUserId,
      parentId: row.parentId,
      name: row.name,
      scale: row.scale,
      terrain: row.terrain,
      environment: row.environment,
      description: row.description,
      content: row.content,
      status: row.status,
      currentRevisionId: row.currentRevisionId ?? "", // Force Entity validation if a required DB value is unexpectedly null.
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return WorldMap.reconstitute(props);
  },

  toPersistence(worldMap: WorldMap): Prisma.MapUncheckedCreateInput {
    const snapshot = worldMap.toSnapshot();

    return {
      projectId: snapshot.projectId,
      createdByUserId: snapshot.createdByUserId,
      parentId: snapshot.parentId,
      name: snapshot.name,
      scale: snapshot.scale,
      terrain: snapshot.terrain,
      environment: snapshot.environment,
      description: snapshot.description,
      content: snapshot.content,
      status: snapshot.status,
      currentRevisionId: snapshot.currentRevisionId,
    };
  },

  toCreatePersistence(worldMap: WorldMap): Prisma.MapUncheckedCreateInput {
    return {
      ...this.toPersistence(worldMap),
      currentRevisionId: null
    }
  },

  toUpdatePersistence(worldMap: WorldMap): Prisma.MapUncheckedUpdateManyInput {
    const snapshot = worldMap.toSnapshot();

    return {
      parentId: snapshot.parentId,
      name: snapshot.name,
      scale: snapshot.scale,
      terrain: snapshot.terrain,
      environment: snapshot.environment,
      description: snapshot.description,
      content: snapshot.content,
      status: snapshot.status,
      currentRevisionId: snapshot.currentRevisionId,
      updatedAt: snapshot.updatedAt,
      version: { increment: 1 },
    };
  },
};
