import { FactionMapper } from "./FactionMapper.js";
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  FactionRepositoryConflictError,
  FactionRepositoryNotFoundError,
  FactionRepositoryReferencedError,
} from "../../domain/story/FactionRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { Faction } from "../../domain/story/Faction.js";
import type { FactionRepository } from "../../domain/story/FactionRepository.js";

export type FactionDatabase = Pick<PrismaClient, "faction">;

export class PrismaFactionRepository implements FactionRepository {
  constructor(private readonly client: FactionDatabase) {}

  async findById(id: string): Promise<Faction | null> {
    const row = await this.client.faction.findUnique({
      where: { id },
    });

    return row ? FactionMapper.toDomain(row) : null;
  }

  async findByProjectId(projectId: string): Promise<Faction[]> {
    const rows = await this.client.faction.findMany({
      where: {
        projectId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return rows.map((row) => FactionMapper.toDomain(row));
  }

  async insert(faction: Faction): Promise<void> {
    try {
      await this.client.faction.create({
        data: {
          id: faction.id,
          ...FactionMapper.toPersistence(faction),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new FactionRepositoryConflictError();
      }

      // No parent-FK translation here, unlike Layer/WorldMap: Faction has no
      // `parentId`/self-hierarchy, so the only FKs on this table are
      // `projectId`/`createdByUserId`/`currentRevisionId` — all of which the
      // calling Application Service is expected to have sourced from trusted,
      // already-validated context. A P2003 here means a bug upstream (stale
      // reference, broken ordering), not invalid raw user input, so it must
      // surface raw rather than be translated into a misleading domain error.
      throw error;
    }
  }

  async update(faction: Faction): Promise<void> {
    const result = await this.client.faction.updateMany({
      where: {
        id: faction.id,
        version: faction.version,
      },
      data: FactionMapper.toUpdatePersistence(faction),
    });

    // No FK-violation catch here — see insert() for why: Faction has no
    // parent-FK to translate, and a P2003 on any of its other FKs is a bug
    // upstream that must surface raw.
    if (result.count === 1) {
      return;
    }

    // count === 0 is ambiguous: either the row is already gone, or it still
    // exists at a different version — same follow-up as Layer/WorldMap.
    const existing = await this.client.faction.findUnique({
      where: { id: faction.id },
      select: { id: true },
    });

    if (!existing) {
      throw new FactionRepositoryNotFoundError();
    }

    throw new FactionRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.faction.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      // Every P2003 on delete means the same thing: an inbound
      // `onDelete: Restrict` FK is blocking removal because a third row
      // still points at this faction. Today that is
      // `comment_target_factions_faction_id_fkey`
      // (`CommentTargetFaction.faction`, see FactionRepositoryError.ts) —
      // there is no self-reference source the way there is for Layer/
      // WorldMap, but the translation is the same generic catch-all, since
      // delete-side P2003 is never ambiguous.
      if (isForeignKeyViolation(error)) {
        throw new FactionRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.faction.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FactionRepositoryNotFoundError();
    }

    throw new FactionRepositoryConflictError();
  }
}

export function createFactionRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): FactionRepository {
  return new PrismaFactionRepository(prisma);
}
