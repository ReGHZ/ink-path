import { Faction, type FactionProperties } from "../../domain/story/Faction.js";

import type {
  Faction as PrismaFaction,
  Prisma,
} from "../../../../../generated/prisma/client.js";

export const FactionMapper = {
  toDomain(row: PrismaFaction): Faction {
    const props: FactionProperties = {
      id: row.id,
      version: row.version,
      projectId: row.projectId,
      createdByUserId: row.createdByUserId,
      name: row.name,
      description: row.description,
      background: row.background,
      ideology: row.ideology,
      size: row.size,
      content: row.content,
      status: row.status,
      currentRevisionId: row.currentRevisionId ?? "", // Force Entity validation if a required DB value is unexpectedly null.
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return Faction.reconstitute(props);
  },

  toPersistence(faction: Faction): Prisma.FactionUncheckedCreateInput {
    const snapshot = faction.toSnapshot();

    return {
      projectId: snapshot.projectId,
      createdByUserId: snapshot.createdByUserId,
      name: snapshot.name,
      description: snapshot.description,
      background: snapshot.background,
      ideology: snapshot.ideology,
      size: snapshot.size,
      content: snapshot.content,
      status: snapshot.status,
      currentRevisionId: snapshot.currentRevisionId,
    };
  },

  toUpdatePersistence(
    faction: Faction,
  ): Prisma.FactionUncheckedUpdateManyInput {
    const snapshot = faction.toSnapshot();

    return {
      name: snapshot.name,
      description: snapshot.description,
      background: snapshot.background,
      ideology: snapshot.ideology,
      size: snapshot.size,
      content: snapshot.content,
      status: snapshot.status,
      currentRevisionId: snapshot.currentRevisionId,
      updatedAt: snapshot.updatedAt,
      version: { increment: 1 },
    };
  },
};
