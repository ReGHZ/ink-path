import { isRetryableEmbeddingWorkerError } from "./isRetryableEmbeddingWorkerError.js";
import { createRabbitMqConsumer, type RabbitMqMessage } from "../queue/consumer.js";

import type { ContentEventPayload, ContentEventType, EmbeddingWorker } from "./EmbeddingWorker.js";
import type { Consumer } from "../../shared/application/ports/Consumer.js";
import type { RabbitMqManager } from "../queue/rabbitmqManager.js";

const EMBEDDING_WORKER_QUEUE = "embedding-worker";
// Topic wildcard — matches content.created / content.updated / content.deleted alike (§17
// step 1: the worker consumes all three off the same binding). No `exchange` option passed
// below: both RabbitMqPublisher and RabbitMqConsumer default to the same "ink-path.events"
// exchange, which is what content.* events actually publish to at runtime — the `exchange`
// field stored on the outbox_events row itself (e.g. "saas.events") is never read by
// RabbitMqPublisher.publish() (known tech debt), so binding to that value instead would
// silently never receive a single message.
const CONTENT_EVENTS_ROUTING_KEY_PATTERN = "content.*";

// Three attempts (default exponential backoff off the Consumer's own retryBaseDelayMs)
// before a message is dead-lettered — enough to ride out a brief Qdrant/Postgres hiccup
// without holding a prefetch slot for long; anything longer-lived lands safely in the DLQ
// (embedding-worker.dlx) rather than blocking the queue.
const MAX_PROCESSING_ATTEMPTS = 3;

// Explicit and deliberately small — unlike OutboxDispatcher, each message here can trigger
// real model inference (LocalEmbeddingProvider's lazily-loaded @huggingface/transformers
// pipeline, a single memoized session, not designed for unbounded concurrent calls) plus
// several Qdrant/Postgres round-trips. RabbitMqConsumer dispatches deliveries fire-and-
// forget (consumeMessage is never awaited before the next delivery arrives — see
// consumer.ts), so true in-flight concurrency is bounded ONLY by this number; leaving it
// unset defaults to no broker-side limit at all (channel.prefetch() is simply never called),
// which would let RabbitMQ push every queued content.* message at once. Safe either way for
// correctness (§4 staleness guard + idempotent point_id already make concurrent processing
// of the same entity harmless), but a low, explicit number bounds memory/inference
// contention instead of leaving it to chance — revisit once real production volume is known.
const PREFETCH = 4;

export function createEmbeddingWorkerConsumer({
  rabbitmq,
  embeddingWorker,
}: {
  rabbitmq: RabbitMqManager;
  embeddingWorker: EmbeddingWorker;
}): Consumer {
  return createRabbitMqConsumer<ContentEventPayload>(rabbitmq, {
    queue: EMBEDDING_WORKER_QUEUE,
    routingKeyPattern: CONTENT_EVENTS_ROUTING_KEY_PATTERN,
    prefetch: PREFETCH,
    deadLetterExchange: `${EMBEDDING_WORKER_QUEUE}.dlx`,
    maxProcessingAttempts: MAX_PROCESSING_ATTEMPTS,
    isRetryableError: isRetryableEmbeddingWorkerError,
    handleMessage: async (message: RabbitMqMessage<ContentEventPayload>) => {
      await embeddingWorker.handleContentEvent(
        message.routingKey as ContentEventType,
        message.payload,
      );
    },
  });
}
