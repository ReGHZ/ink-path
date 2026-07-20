import { createContentUnitOfWork } from "../PrismaContentUnitOfWork.js";
import { PrismaCharacterRepository } from "./PrismaCharacterRepository.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentUnitOfWork } from "../../application/ports/ContentUnitOfWork.js";
import type { CharacterRepository } from "../../domain/story/CharacterRepository.js";

export function createCharacterUnitOfWork({ prisma }: { prisma: PrismaClient }): ContentUnitOfWork<CharacterRepository> {
    return createContentUnitOfWork({
        prisma,
        createEntityRepository: (tx) => new PrismaCharacterRepository(tx),
    });
}
