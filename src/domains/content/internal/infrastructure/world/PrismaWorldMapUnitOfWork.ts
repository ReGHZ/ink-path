import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaWorldMapRepository } from "./PrismaWorldMapRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { WorldMapRepository } from "../../domain/world/WorldMapRepository.js";

export function createWorldMapUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<WorldMapRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaWorldMapRepository(tx),
    });
}
