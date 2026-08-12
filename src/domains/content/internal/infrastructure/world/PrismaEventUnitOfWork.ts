import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaEventRepository } from "./PrismaEventRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { EventRepository } from "../../domain/world/EventRepository.js";

export function createEventUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<EventRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaEventRepository(tx),
    });
}
