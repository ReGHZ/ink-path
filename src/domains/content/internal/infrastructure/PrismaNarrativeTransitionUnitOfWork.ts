import { PrismaChapterRepository } from "./story/PrismaChapterRepository.js";
import { PrismaCharacterRepository } from "./story/PrismaCharacterRepository.js";
import { PrismaFactionRepository } from "./story/PrismaFactionRepository.js";
import { PrismaPlotRepository } from "./story/PrismaPlotRepository.js";
import { PrismaSceneRepository } from "./story/PrismaSceneRepository.js";
import { PrismaContentRelationshipRepository } from "./support/PrismaContentRelationshipRepository.js";
import { PrismaContentRevisionRepository } from "./support/PrismaContentRevisionRepository.js";
import { PrismaAssertionRepository } from "./transition/PrismaAssertionRepository.js";
import { PrismaNarrativeTransitionRepository } from "./transition/PrismaNarrativeTransitionRepository.js";
import { PrismaEventRepository } from "./world/PrismaEventRepository.js";
import { PrismaLayerRepository } from "./world/PrismaLayerRepository.js";
import { PrismaWorldElementRepository } from "./world/PrismaWorldElementRepository.js";
import { PrismaWorldMapRepository } from "./world/PrismaWorldMapRepository.js";
import {
  Prisma,
  type PrismaClient,
} from "../../../../generated/prisma/client.js";
import { PrismaOutboxEventRepository } from "../../../../shared/infrastructure/PrismaOutboxEventRepository.js";
import { createContentAttributeMutator } from "../application/transition/contentAttributeMutator.js";

import type { OutboxEventRepository } from "../../../../shared/application/ports/OutboxEventRepository.js";
import type {
  NarrativeTransitionRepositories,
  NarrativeTransitionUnitOfWork,
} from "../application/ports/NarrativeTransitionUnitOfWork.js";

// Every repository below is built over `tx`, including the nine that back the
// attribute mutator. That is the whole reason this class exists rather than a
// reuse of `PrismaContentUnitOfWork`: applying an assertion locks
// `assertions`, then writes an entity table, `content_revisions`,
// `content_relationships` and `outbox_events` — and a lock only covers writes
// made through the connection that holds it.
//
// The nine repositories are constructed on every transaction. They are closures
// over a client and hold no state, so this costs nine object allocations per
// apply and buys the guarantee that none of them can accidentally be the pooled
// one. The alternative — caching them per client — would keep a map keyed by
// something that changes on every transaction.
export class PrismaNarrativeTransitionUnitOfWork
  implements NarrativeTransitionUnitOfWork
{
  constructor(private readonly client: PrismaClient) {}

  async transaction<T>(
    work: (
      repositories: NarrativeTransitionRepositories,
      outboxEvents: OutboxEventRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(
      async (tx) => {
        return work(
          {
            narrativeTransitions: new PrismaNarrativeTransitionRepository(tx),
            assertions: new PrismaAssertionRepository(tx),
            contentRelationships: new PrismaContentRelationshipRepository(tx),
            contentAttributes: createContentAttributeMutator({
              layerRepository: new PrismaLayerRepository(tx),
              worldMapRepository: new PrismaWorldMapRepository(tx),
              worldElementRepository: new PrismaWorldElementRepository(tx),
              factionRepository: new PrismaFactionRepository(tx),
              characterRepository: new PrismaCharacterRepository(tx),
              eventRepository: new PrismaEventRepository(tx),
              plotRepository: new PrismaPlotRepository(tx),
              chapterRepository: new PrismaChapterRepository(tx),
              sceneRepository: new PrismaSceneRepository(tx),
              contentRevisionRepository: new PrismaContentRevisionRepository(tx),
            }),
          },
          new PrismaOutboxEventRepository(tx),
        );
      },
      // READ COMMITTED, the same level every content transaction runs at. The
      // apply path does not rely on the isolation level for its correctness — it
      // relies on the row lock its own conditional writes take (`claimForApply`,
      // `deleteIfPending`: the predicate rides inside the statement, so the loser
      // waits in the row's lock queue and then re-reads what the winner
      // committed). Raising the level would buy nothing and cost serialisation
      // failures on unrelated writes.
      //
      // Said `FOR UPDATE` until gerbang G2 (G2-2) — a justification for this
      // isolation level resting on a lock step 4b-5 removed.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}

export function createNarrativeTransitionUnitOfWork({
  prisma,
}: {
  prisma: PrismaClient;
}): NarrativeTransitionUnitOfWork {
  return new PrismaNarrativeTransitionUnitOfWork(prisma);
}
