import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaPlotRepository } from "./PrismaPlotRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { PlotRepository } from "../../domain/story/PlotRepository.js";

export function createPlotUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<PlotRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaPlotRepository(tx),
    });
}
