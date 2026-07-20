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
          ...WorldElementMapper.toCreatePersistence(worldElement),
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

  async linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void> {
    const result = await this.client.worldElement.updateMany({
      where: {
        id,
        version: expectedVersion,
        // Only ever true for a row insert() just wrote — this is the
        // mechanical guard against calling linkRevision() outside the
        // create-flow (no type-level restriction stops that; see
        // WorldElementRepository doc comment). If currentRevisionId is
        // already set, this WHERE simply fails to match, and the row falls
        // into the ambiguous count===0 path below as a Conflict.
        currentRevisionId: null,
      },
      // No `version: { increment: 1 }` here, unlike update() — completing
      // the create-flow's revision link is not a discrete edit (policy 06
      // §3: "no-op tidak menaikkan version", and this is the create
      // operation finishing, not a new change). A world element that has
      // never been touched after creation must still read `version === 0`,
      // and content_revisions.revisionNumber for the create revision is
      // captured as `version` at construction time (0) — bumping here would
      // desync the two and leave a gap the first real edit's revisionNumber
      // would never fill.
      data: {
        currentRevisionId: revisionId,
      },
    });

    if (result.count === 1) {
      return;
    }

    // count === 0 is ambiguous: either the row is already gone, or it still
    // exists at a different version — same follow-up as update(). In
    // practice this should never fire (nothing else can see this row before
    // this transaction commits), but the check stays as a defensive
    // integrity assertion, not real concurrency control.
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
