import { PrismaContentRevisionRepository } from "./support/PrismaContentRevisionRepository.js";
import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js";

import type {
    ContentRepositories,
    ContentUnitOfWork,
} from "../application/ports/ContentUnitOfWork.js";

export class PrismaContentUnitOfWork<TEntityRepo> implements ContentUnitOfWork<TEntityRepo> {
    constructor(
        private readonly client: PrismaClient,
        private readonly createEntityRepository: (tx: Prisma.TransactionClient) => TEntityRepo,
    ) { }

    async transaction<T>(work: (r: ContentRepositories<TEntityRepo>) => Promise<T>): Promise<T> {
        return this.client.$transaction(async (tx) => {
            return work({
                entity: this.createEntityRepository(tx),
                contentRevisions: new PrismaContentRevisionRepository(tx),
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    }
}

export function createContentUnitOfWork<TEntityRepo>({
    prisma,
    createEntityRepository,
}: {
    prisma: PrismaClient;
    createEntityRepository: (tx: Prisma.TransactionClient) => TEntityRepo;
}): ContentUnitOfWork<TEntityRepo> {
    return new PrismaContentUnitOfWork(prisma, createEntityRepository);
}
