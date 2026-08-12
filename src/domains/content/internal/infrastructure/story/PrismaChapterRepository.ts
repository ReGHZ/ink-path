import { ChapterMapper } from "./ChapterMapper.js";
import {
  isUniqueViolation,
  isForeignKeyViolation,
  matchesUniqueConstraint,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  ChapterRepositoryConflictError,
  ChapterRepositoryNotFoundError,
  ChapterRepositoryOrderConflictError,
  ChapterRepositoryReferencedError,
} from "../../domain/story/ChapterRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { Chapter } from "../../domain/story/Chapter.js";
import type { ChapterRepository } from "../../domain/story/ChapterRepository.js";

export type ChapterDatabase = Pick<PrismaClient, "chapter">;

// Columns of `chapters_project_id_order_key` (`@@unique([projectId, order])`,
// `content-story.prisma:152`). DATABASE column names, not Prisma field names —
// the driver adapter reports `project_id`, not `projectId`. VERIFIED
// empirically (Postgres 17 / Prisma 7.8.0, probe 2026-08-12): a P2002 here
// carries `constraint.fields: ["project_id", "\"order\""]`, quoted because
// `order` is a reserved word; `matchesUniqueConstraint` unquotes before
// comparing. Localizing the schema coupling here mirrors LAYER_PARENT_FK.
const CHAPTER_ORDER_UNIQUE = ["project_id", "order"] as const;

export class PrismaChapterRepository implements ChapterRepository {
  constructor(private readonly client: ChapterDatabase) { }

  async findById(id: string): Promise<Chapter | null> {
    const row = await this.client.chapter.findUnique({
      where: { id },
    });

    return row ? ChapterMapper.toDomain(row) : null;
  }

  async findByProjectId(projectId: string): Promise<Chapter[]> {
    const rows = await this.client.chapter.findMany({
      where: {
        projectId,
      },
      orderBy: {
        order: "asc",
      },
    });

    return rows.map((row) => ChapterMapper.toDomain(row));
  }

  async insert(chapter: Chapter): Promise<void> {
    try {
      await this.client.chapter.create({
        data: {
          id: chapter.id,
          ...ChapterMapper.toCreatePersistence(chapter),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw matchesUniqueConstraint(error, CHAPTER_ORDER_UNIQUE)
          ? new ChapterRepositoryOrderConflictError()
          : new ChapterRepositoryConflictError();
      }

      throw error;
    }
  }

  async update(chapter: Chapter): Promise<void> {
    let result;
    try {
      result = await this.client.chapter.updateMany({
        where: {
          id: chapter.id,
          version: chapter.version,
        },
        data: ChapterMapper.toUpdatePersistence(chapter),
      });
    } catch (error) {
      // Reachable on update too, not just insert: updateDetails() may move a
      // chapter onto a position a sibling already holds.
      if (isUniqueViolation(error)) {
        throw matchesUniqueConstraint(error, CHAPTER_ORDER_UNIQUE)
          ? new ChapterRepositoryOrderConflictError()
          : new ChapterRepositoryConflictError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.chapter.findUnique({
      where: { id: chapter.id },
      select: { id: true },
    });

    if (!existing) {
      throw new ChapterRepositoryNotFoundError();
    }

    throw new ChapterRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.chapter.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      // Every P2003 on delete means an inbound Restrict FK still points here —
      // a surviving scene today, a comment target once Feedback exists.
      if (isForeignKeyViolation(error)) {
        throw new ChapterRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.chapter.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new ChapterRepositoryNotFoundError();
    }

    throw new ChapterRepositoryConflictError();
  }

  // Create-flow only (policy 06 §4). See PrismaEventRepository.linkRevision().
  async linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void> {
    const result = await this.client.chapter.updateMany({
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

    const existing = await this.client.chapter.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new ChapterRepositoryNotFoundError();
    }

    throw new ChapterRepositoryConflictError();
  }
}

export function createChapterRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): ChapterRepository {
  return new PrismaChapterRepository(prisma);
}
