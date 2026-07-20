import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaWorldElementRepository } from "./PrismaWorldElementRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { WorldElementRepository } from "../../domain/world/WorldElementRepository.js";

export function createWorldElementUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<WorldElementRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaWorldElementRepository(tx),
    });
}
