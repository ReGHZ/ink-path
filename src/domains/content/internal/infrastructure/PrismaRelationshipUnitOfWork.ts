import { PrismaContentRelationshipRepository } from "./support/PrismaContentRelationshipRepository.js";
import { PrismaTransitionEffectRepository } from "./transition/PrismaTransitionEffectRepository.js";
import {
  Prisma,
  type PrismaClient,
} from "../../../../generated/prisma/client.js";
import { PrismaOutboxEventRepository } from "../../../../shared/infrastructure/PrismaOutboxEventRepository.js";

import type { OutboxEventRepository } from "../../../../shared/application/ports/OutboxEventRepository.js";
import type {
  RelationshipRepositories,
  RelationshipUnitOfWork,
} from "../application/ports/RelationshipUnitOfWork.js";

// Both repositories built over `tx`, same rule as the narrative unit of work:
// the assertion, the projection row and the outbox row are one fact split
// across three tables, and a repository over the pooled client would put one of
// them outside the transaction with nothing to notice.
export class PrismaRelationshipUnitOfWork implements RelationshipUnitOfWork {
  constructor(private readonly client: PrismaClient) {}

  async transaction<T>(
    work: (
      repositories: RelationshipRepositories,
      outboxEvents: OutboxEventRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(
      async (tx) => {
        return work(
          {
            assertions: new PrismaTransitionEffectRepository(tx),
            contentRelationships: new PrismaContentRelationshipRepository(tx),
          },
          new PrismaOutboxEventRepository(tx),
        );
      },
      // READ COMMITTED, like every other content transaction. Nothing here
      // depends on the isolation level: duplicate detection is the six-column
      // unique index, which holds at any level.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}

export function createRelationshipUnitOfWork({
  prisma,
}: {
  prisma: PrismaClient;
}): RelationshipUnitOfWork {
  return new PrismaRelationshipUnitOfWork(prisma);
}
