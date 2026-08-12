import { SceneMapper } from "./SceneMapper.js";
import {
  isUniqueViolation,
  isForeignKeyViolation,
  extractForeignKeyConstraint,
  matchesUniqueConstraint,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  SceneRepositoryChapterNotFoundError,
  SceneRepositoryConflictError,
  SceneRepositoryNotFoundError,
  SceneRepositoryOrderConflictError,
  SceneRepositoryReferencedError,
} from "../../domain/story/SceneRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { Scene } from "../../domain/story/Scene.js";
import type { SceneRepository } from "../../domain/story/SceneRepository.js";

export type SceneDatabase = Pick<PrismaClient, "scene">;

// FK constraint name for the `chapterId` parent reference. VERIFIED
// empirically (Postgres 17 / Prisma 7.8.0, probe 2026-08-12): a P2003 on it
// arrives as `meta.driverAdapterError.cause.constraint.index ===
// "scenes_chapter_id_fkey"`, the same shape LAYER_PARENT_FK relies on.
const SCENE_CHAPTER_FK = "scenes_chapter_id_fkey";

// Columns of `scenes_chapter_id_order_in_chapter_key`
// (`@@unique([chapterId, orderInChapter])`, `content-story.prisma:185`).
// Database column names — see the note on CHAPTER_ORDER_UNIQUE.
const SCENE_ORDER_UNIQUE = ["chapter_id", "order_in_chapter"] as const;

export class PrismaSceneRepository implements SceneRepository {
  constructor(private readonly client: SceneDatabase) { }

  async findById(id: string): Promise<Scene | null> {
    const row = await this.client.scene.findUnique({
      where: { id },
    });

    return row ? SceneMapper.toDomain(row) : null;
  }

  async findByChapterId(projectId: string, chapterId: string): Promise<Scene[]> {
    const rows = await this.client.scene.findMany({
      where: {
        // Both columns, not just `chapterId`: tenant scoping is enforced in
        // the repository (see the port's doc comment). `scenes.project_id` is
        // indexed (`content-story.prisma:186`), so this costs nothing.
        projectId,
        chapterId,
      },
      orderBy: {
        orderInChapter: "asc",
      },
    });

    return rows.map((row) => SceneMapper.toDomain(row));
  }

  async insert(scene: Scene): Promise<void> {
    try {
      await this.client.scene.create({
        data: {
          id: scene.id,
          ...SceneMapper.toCreatePersistence(scene),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw matchesUniqueConstraint(error, SCENE_ORDER_UNIQUE)
          ? new SceneRepositoryOrderConflictError()
          : new SceneRepositoryConflictError();
      }

      if (
        isForeignKeyViolation(error) &&
        extractForeignKeyConstraint(error) === SCENE_CHAPTER_FK
      ) {
        throw new SceneRepositoryChapterNotFoundError();
      }

      throw error;
    }
  }

  async update(scene: Scene): Promise<void> {
    let result;
    try {
      result = await this.client.scene.updateMany({
        where: {
          id: scene.id,
          version: scene.version,
        },
        data: SceneMapper.toUpdatePersistence(scene),
      });
    } catch (error) {
      // Reachable when updateDetails() moves a scene onto a position a
      // sibling already holds.
      if (isUniqueViolation(error)) {
        throw matchesUniqueConstraint(error, SCENE_ORDER_UNIQUE)
          ? new SceneRepositoryOrderConflictError()
          : new SceneRepositoryConflictError();
      }

      // `chapterId` is not in toUpdatePersistence(), so the parent FK cannot
      // be re-pointed by an update — but the constraint is still checked, and
      // a concurrent chapter delete could in principle race it. Translating it
      // here keeps insert and update reading the same rather than letting one
      // path surface raw.
      if (
        isForeignKeyViolation(error) &&
        extractForeignKeyConstraint(error) === SCENE_CHAPTER_FK
      ) {
        throw new SceneRepositoryChapterNotFoundError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.scene.findUnique({
      where: { id: scene.id },
      select: { id: true },
    });

    if (!existing) {
      throw new SceneRepositoryNotFoundError();
    }

    throw new SceneRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.scene.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      // On delete a P2003 can only mean an inbound Restrict FK still points
      // here (comment targets once Feedback exists) — never "chapter missing",
      // which is why the constraint name is not matched on this path.
      if (isForeignKeyViolation(error)) {
        throw new SceneRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.scene.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new SceneRepositoryNotFoundError();
    }

    throw new SceneRepositoryConflictError();
  }

  // Create-flow only (policy 06 §4). See PrismaEventRepository.linkRevision().
  async linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void> {
    const result = await this.client.scene.updateMany({
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

    const existing = await this.client.scene.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new SceneRepositoryNotFoundError();
    }

    throw new SceneRepositoryConflictError();
  }
}

export function createSceneRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): SceneRepository {
  return new PrismaSceneRepository(prisma);
}
