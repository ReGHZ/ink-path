import { WorldMapMapper } from "./WorldMapMapper.js";
import {
  extractForeignKeyConstraint,
  isForeignKeyViolation,
  isUniqueViolation,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  WorldMapRepositoryConflictError,
  WorldMapRepositoryNotFoundError,
  WorldMapRepositoryParentNotFoundError,
  WorldMapRepositoryReferencedError,
} from "../../domain/world/WorldMapRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { WorldMap } from "../../domain/world/WorldMap.js";
import type { WorldMapRepository } from "../../domain/world/WorldMapRepository.js";

export type WorldMapDatabase = Pick<PrismaClient, "map">;

// Same as layer
const MAP_PARENT_FK = "maps_parent_id_fkey";

export class PrismaWorldMapRepository implements WorldMapRepository {
  constructor(private readonly client: WorldMapDatabase) { }

  async findById(id: string): Promise<WorldMap | null> {
    const row = await this.client.map.findUnique({
      where: { id },
    });

    return row ? WorldMapMapper.toDomain(row) : null;
  }

  async findByProjectId(projectId: string): Promise<WorldMap[]> {
    const rows = await this.client.map.findMany({
      where: {
        projectId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return rows.map((row) => WorldMapMapper.toDomain(row));
  }

  async insert(worldMap: WorldMap): Promise<void> {
    try {
      await this.client.map.create({
        data: {
          id: worldMap.id,
          ...WorldMapMapper.toCreatePersistence(worldMap),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WorldMapRepositoryConflictError();
      }
      if (
        isForeignKeyViolation(error) &&
        extractForeignKeyConstraint(error) === MAP_PARENT_FK
      ) {
        throw new WorldMapRepositoryParentNotFoundError();
      }
      throw error;
    }
  }

  async update(worldMap: WorldMap): Promise<void> {
    let result;
    try {
      result = await this.client.map.updateMany({
        where: {
          id: worldMap.id,
          version: worldMap.version,
        },
        data: WorldMapMapper.toUpdatePersistence(worldMap),
      });
    } catch (error) {
      if (
        isForeignKeyViolation(error) &&
        extractForeignKeyConstraint(error) === MAP_PARENT_FK
      ) {
        throw new WorldMapRepositoryParentNotFoundError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    // count === 0 is ambiguous: either the row is already gone, or it still
    // exists at a different version — same follow-up as PrismaLayerRepository.
    const existing = await this.client.map.findUnique({
      where: { id: worldMap.id },
      select: { id: true },
    });

    if (!existing) {
      throw new WorldMapRepositoryNotFoundError();
    }

    throw new WorldMapRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.map.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      // same as layer
      if (isForeignKeyViolation(error)) {
        throw new WorldMapRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.map.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new WorldMapRepositoryNotFoundError();
    }

    throw new WorldMapRepositoryConflictError();
  }

  // Create-flow only (policy 06 §4, currentRevisionId circular dependency):
  // sets currentRevisionId after content_revisions has been inserted in the
  // same transaction. WHERE requires currentRevisionId: null so this is
  // mechanically impossible to call outside the create-flow — any row that
  // already has one falls into the ambiguous count===0 path as a Conflict.
  // No version bump: completing create is not a discrete edit (policy 06 §3
  // no-op rule), so a freshly created, never-edited row must still read
  // version === 0 after this call.
  async linkRevision(id: string, revisionId: string, expectedVersion: number): Promise<void> {
    const result = await this.client.map.updateMany({
      where: {
        id,
        version: expectedVersion,
        currentRevisionId: null
      },
      data: {
        currentRevisionId: revisionId
      }
    })

    if (result.count === 1) {
      return
    }

    const existing = await this.client.map.findUnique({
      where: { id },
      select: { id: true }
    })

    if (!existing) {
      throw new WorldMapRepositoryNotFoundError()
    }

    throw new WorldMapRepositoryConflictError()

  }
}

export function createWorldMapRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): WorldMapRepository {
  return new PrismaWorldMapRepository(prisma);
}
