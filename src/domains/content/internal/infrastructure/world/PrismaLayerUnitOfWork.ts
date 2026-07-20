import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaLayerRepository } from "./PrismaLayerRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { LayerRepository } from "../../domain/world/LayerRepository.js";

export function createLayerUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<LayerRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaLayerRepository(tx),
    });
}
