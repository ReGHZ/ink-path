import { WorldElementMapper } from "./WorldElementMapper.js";
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  WorldElementRepositoryConflictError,
  WorldElementRepositoryNotFoundError,
  WorldElementRepositoryReferencedError,
} from "../../domain/world/WorldElementRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { WorldElement } from "../../domain/world/WorldElement.js";
import type { WorldElementRepository } from "../../domain/world/WorldElementRepository.js";

export type WorldElementDatabase = Pick<PrismaClient, "worldElement">;

export class PrismaWorldElementRepository implements WorldElementRepository {
  constructor(private readonly client: WorldElementDatabase) {}

  async findById(id: string): Promise<WorldElement | null> {
    const row = await this.client.worldElement.findUnique({
      where: { id },
    });

    return row ? WorldElementMapper.toDomain(row) : null;
  }

  async findByProjectId(projectId: string): Promise<WorldElement[]> {
    const rows = await this.client.worldElement.findMany({
      where: {
        projectId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return rows.map((row) => WorldElementMapper.toDomain(row));
  }

  async insert(worldElement: WorldElement): Promise<void> {
    try {
      await this.client.worldElement.create({
        data: {
          id: worldElement.id,
          ...WorldElementMapper.toPersistence(worldElement),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WorldElementRepositoryConflictError();
      }

      // No parent-FK translation here, unlike Layer/WorldMap: WorldElement
      // has no `parentId`/self-hierarchy, so the only FKs on this table are
      // `projectId`/`createdByUserId`/`currentRevisionId` — all of which the
      // calling Application Service is expected to have sourced from trusted,
      // already-validated context. A P2003 here means a bug upstream (stale
      // reference, broken ordering), not invalid raw user input, so it must
      // surface raw rather than be translated into a misleading domain error.
      throw error;
    }
  }

  async update(worldElement: WorldElement): Promise<void> {
    const result = await this.client.worldElement.updateMany({
      where: {
        id: worldElement.id,
        version: worldElement.version,
      },
      data: WorldElementMapper.toUpdatePersistence(worldElement),
    });

    // No FK-violation catch here — see insert() for why: WorldElement has no
    // parent-FK to translate, and a P2003 on any of its other FKs is a bug
    // upstream that must surface raw.
    if (result.count === 1) {
      return;
    }

    // count === 0 is ambiguous: either the row is already gone, or it still
    // exists at a different version — same follow-up as Layer/WorldMap.
    const existing = await this.client.worldElement.findUnique({
      where: { id: worldElement.id },
      select: { id: true },
    });

    if (!existing) {
      throw new WorldElementRepositoryNotFoundError();
    }

    throw new WorldElementRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.worldElement.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      // Every P2003 on delete means the same thing: an inbound
      // `onDelete: Restrict` FK is blocking removal because a third row
      // still points at this world element. Today that is
      // `comment_target_world_elements_world_element_id_fkey`
      // (`CommentTargetWorldElement.worldElement`, see
      // WorldElementRepositoryError.ts) — there is no self-reference source
      // the way there is for Layer/WorldMap, but the translation is the same
      // generic catch-all, since delete-side P2003 is never ambiguous.
      if (isForeignKeyViolation(error)) {
        throw new WorldElementRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.worldElement.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new WorldElementRepositoryNotFoundError();
    }

    throw new WorldElementRepositoryConflictError();
  }
}

export function createWorldElementRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): WorldElementRepository {
  return new PrismaWorldElementRepository(prisma);
}
