import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaSceneRepository } from "./PrismaSceneRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { SceneRepository } from "../../domain/story/SceneRepository.js";

export function createSceneUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<SceneRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaSceneRepository(tx),
    });
}
