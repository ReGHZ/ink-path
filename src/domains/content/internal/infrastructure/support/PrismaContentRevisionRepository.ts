import { ContentRevisionMapper } from "./ContentRevisionMapper.js";
import { isUniqueViolation } from "../../../../../shared/infrastructure/prismaErrors.js";
import { ContentRevisionRepositoryConflictError } from "../../domain/support/ContentRevisionRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type {
  ContentEntityType,
  ContentRevision,
} from "../../domain/support/ContentRevision.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";

export type ContentRevisionDatabase = Pick<PrismaClient, "contentRevision">;

export class PrismaContentRevisionRepository implements ContentRevisionRepository {
  constructor(private readonly client: ContentRevisionDatabase) {}

  async findById(id: string): Promise<ContentRevision | null> {
    const row = await this.client.contentRevision.findUnique({
      where: { id },
    });

    return row ? ContentRevisionMapper.toDomain(row) : null;
  }

  async findByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRevision[]> {
    const rows = await this.client.contentRevision.findMany({
      where: {
        projectId,
        entityType,
        entityId,
      },
      orderBy: {
        revisionNumber: "asc",
      },
    });

    return rows.map((row) => ContentRevisionMapper.toDomain(row));
  }

  async insert(contentRevision: ContentRevision): Promise<void> {
    try {
      await this.client.contentRevision.create({
        data: {
          id: contentRevision.id,
          ...ContentRevisionMapper.toPersistence(contentRevision),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ContentRevisionRepositoryConflictError();
      }

      throw error;
    }
  }
}

export function createContentRevisionRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): ContentRevisionRepository {
  return new PrismaContentRevisionRepository(prisma);
}
