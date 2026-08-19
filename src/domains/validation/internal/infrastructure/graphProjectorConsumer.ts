import { isRetryableGraphProjectorError } from "./isRetryableGraphProjectorError.js";
import { logger } from "../../../../infrastructure/logger.js";
import {
  createRabbitMqConsumer,
  type RabbitMqMessage,
} from "../../../../infrastructure/queue/consumer.js";
import { GRAPH_PROJECTOR_BINDINGS } from "../../../../shared/application/events/routingKeys.js";

import type { RabbitMqManager } from "../../../../infrastructure/queue/rabbitmqManager.js";
import type { Consumer } from "../../../../shared/application/ports/Consumer.js";
import type {
  GraphProjector,
  GraphProjectorEventPayload,
} from "../application/GraphProjector.js";

const GRAPH_PROJECTOR_QUEUE = "graph-projector";

// Three attempts, same as the embedding worker: enough to ride out a Postgres hiccup
// or a lost race with a concurrent fold without holding a prefetch slot for long.
// Everything the classifier calls non-retryable skips the budget entirely and
// dead-letters on the first failure, which is the point of having a classifier.
const MAX_PROCESSING_ATTEMPTS = 3;

// Bounded BY THE CONNECTION POOL, not by taste. `createPrismaClient()` builds `PrismaPg`
// with no `max`, so the pool is node-postgres' default of 10, and every in-flight message
// here holds a connection for its log read and again for its fold transaction. The first
// version of this file said 16 — above the pool — which turns a burst into `P2024`
// (pool timeout) rather than into throughput. 8 leaves headroom for the API process
// sharing the same database and still runs the fold well ahead of the outbox dispatcher's
// ~1s poll.
//
// `P2024` is ALSO classified transient (`shared/infrastructure/prismaErrors.ts`), because
// arithmetic on a default is not a guarantee: if the pool is contended anyway, the honest
// answer is to retry the message, not to dead-letter a fact.
//
// Still explicit rather than unset: leaving it out means no `channel.prefetch()` call at
// all, and RabbitMQ pushes every queued message at once.
//
// Concurrency here is safe rather than merely tolerated: each fold is one transaction keyed
// on the assertion id, two deliveries about the same fact converge, and ORDER between two
// messages about one assertion no longer decides the outcome — `GraphProjector.fold()` asks
// the log whether the claim was withdrawn (blokir G4-1).
const PREFETCH = 8;

export function createGraphProjectorConsumer({
  rabbitmq,
  graphProjector,
}: {
  rabbitmq: RabbitMqManager;
  graphProjector: GraphProjector;
}): Consumer {
  return createRabbitMqConsumer<GraphProjectorEventPayload>(rabbitmq, {
    queue: GRAPH_PROJECTOR_QUEUE,
    // TWO patterns (`content.relationship.*` + `narrative.effect.*`), which is why
    // `createRabbitMqConsumer` learned to loop `bindQueue` at this step. Imported,
    // never spelled out: `routingKeys.test.ts` walks production sources and fails on
    // a routing-key literal outside that module, which is what keeps a binding and
    // the keys it is supposed to match from drifting apart in silence (gerbang G1,
    // T-1 — the drift that made a published event reach no queue at all).
    routingKeyPattern: GRAPH_PROJECTOR_BINDINGS,
    prefetch: PREFETCH,
    deadLetterExchange: `${GRAPH_PROJECTOR_QUEUE}.dlx`,
    maxProcessingAttempts: MAX_PROCESSING_ATTEMPTS,
    isRetryableError: isRetryableGraphProjectorError,
    handleMessage: async (
      message: RabbitMqMessage<GraphProjectorEventPayload>,
    ) => {
      // The routing key is passed through as the STRING the broker delivered, not
      // cast to a union: the projector branches on it and throws for anything it has
      // no fold for, so a new verb under either bound prefix dead-letters with a
      // message naming the key. Casting it would move that failure to a place where
      // it reads as a type error instead.
      const outcome = await graphProjector.handleEvent(
        message.routingKey,
        message.payload,
      );

      // The outcome is the fold's only observable — `terminate` deliberately changes no row,
      // and a retraction that matched nothing is indistinguishable from one that matched.
      // Awaiting it and dropping it (as this handler first did) left "explicit no-op" alive
      // only in tests, and left the ONE trace of an ordering anomaly invisible in
      // production.
      //
      // `warn` for the two answers that mean "something arrived that the graph did not
      // need": a retraction that removed nothing, and a claim the log had already
      // withdrawn. Neither is an error — both are documented, normal answers — but a run of
      // them is what a human needs to see when the graph looks wrong.
      const unremarkable =
        (outcome.kind === "unfolded" && outcome.edgesRemoved > 0) ||
        outcome.kind === "folded" ||
        (outcome.kind === "ignored" &&
          outcome.reason !== "already_retracted_in_the_log");

      if (unremarkable) {
        logger.debug(
          { routingKey: message.routingKey, outcome },
          "Graph projector folded an event",
        );

        return;
      }

      logger.warn(
        { routingKey: message.routingKey, outcome },
        "Graph projector processed an event that changed nothing in the graph",
      );
    },
  });
}
