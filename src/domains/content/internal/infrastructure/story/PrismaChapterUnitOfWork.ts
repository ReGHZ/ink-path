import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaChapterRepository } from "./PrismaChapterRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { ChapterRepository } from "../../domain/story/ChapterRepository.js";

export function createChapterUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<ChapterRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaChapterRepository(tx),
    });
}
