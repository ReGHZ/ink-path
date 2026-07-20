import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaFactionRepository } from "./PrismaFactionRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { FactionRepository } from "../../domain/story/FactionRepository.js";

export function createFactionUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<FactionRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaFactionRepository(tx),
    });
}
