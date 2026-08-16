import { PrismaContentRelationshipRepository } from "./support/PrismaContentRelationshipRepository.js";
import { PrismaContentRevisionRepository } from "./support/PrismaContentRevisionRepository.js";
import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js";
import { PrismaOutboxEventRepository } from "../../../../shared/infrastructure/PrismaOutboxEventRepository.js";

import type { OutboxEventRepository } from "../../../../shared/application/ports/OutboxEventRepository.js";
import type {
    ContentRepositories,
    ContentUnitOfWork,
} from "../application/ports/ContentUnitOfWork.js";

export class PrismaContentUnitOfWork<TEntityRepo> implements ContentUnitOfWork<TEntityRepo> {
    constructor(
        private readonly client: PrismaClient,
        private readonly createEntityRepository: (tx: Prisma.TransactionClient) => TEntityRepo,
    ) { }

    async transaction<T>(
        work: (
            repositories: ContentRepositories<TEntityRepo>,
            outboxEvents: OutboxEventRepository,
        ) => Promise<T>,
    ): Promise<T> {
        return this.client.$transaction(async (tx) => {
            return work(
                {
                    entity: this.createEntityRepository(tx),
                    contentRevisions: new PrismaContentRevisionRepository(tx),
                    // Built from `tx`, exactly like the revision repository: the
                    // 7.4b delete guard must see this transaction's own view.
                    // The adapter takes `Pick<PrismaClient, "contentRelationship">`,
                    // which a TransactionClient satisfies structurally — no
                    // second factory needed.
                    contentRelationships: new PrismaContentRelationshipRepository(tx),
                },
                new PrismaOutboxEventRepository(tx),
            );
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
