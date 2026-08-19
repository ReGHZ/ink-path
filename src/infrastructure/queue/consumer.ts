import { setTimeout as sleep } from "node:timers/promises";

import { logger } from "../logger.js";

import type { RabbitMqChannel, RabbitMqManager } from "./rabbitmqManager.js";
import type { Consumer } from "../../shared/application/ports/Consumer.js";
import type { ConsumeMessage } from "amqplib";

const DEFAULT_EXCHANGE = "ink-path.events";

export type RabbitMqMessage<Payload = unknown> = {
  payload: Payload;
  routingKey: string;
};

export type RabbitMqMessageHandler<Payload = unknown> = (
  message: RabbitMqMessage<Payload>,
) => Promise<void> | void;

type RabbitMqConsumerOptions<Payload = unknown> = {
  exchange?: string;
  prefetch?: number;
  queue: string;
  // ONE pattern or MANY (step 4b-4, stage C). It stayed singular while every
  // consumer needed one binding; `GraphProjector` needs two —
  // `content.relationship.*` and `narrative.effect.*` — because the two prefixes are
  // what the producers guarantee and `content.#` would also deliver every entity
  // text change in the system (`shared/application/events/routingKeys.ts`,
  // GRAPH_PROJECTOR_BINDINGS).
  //
  // Widened rather than replaced: `string` keeps every existing caller and every
  // existing test untouched, and a queue with exactly one binding is still the
  // common case, not a degenerate array.
  //
  // NON-EMPTY by type, not by a runtime check. A queue bound to nothing is the worst
  // shape this option can take — it is created, it is consumed from, it reports
  // healthy, and no message ever arrives — and every pattern in this codebase is a
  // module constant, so `tsc` can refuse the empty case outright. A constructor throw
  // would instead be a branch guarding a state the type system already makes
  // unreachable, testable only by casting one into existence.
  routingKeyPattern: string | readonly [string, ...string[]];
  handleMessage: RabbitMqMessageHandler<Payload>;
  // If set, a message that ends up nacked (retries exhausted, or a non-retryable
  // failure) lands in a durable queue bound to this exchange instead of being
  // silently discarded — RabbitMQ's default for nack(requeue=false) with no DLX
  // bound is to drop the message with no trace at all. §01_dlq_semantics.md
  // states "RabbitMQ tetap source of truth untuk consumer failure Phase 1", which
  // is only actually true once a DLX is configured — omitting this option keeps
  // today's original behavior (drop, no DLX) for consumers that don't opt in.
  deadLetterExchange?: string;
  // Bounded IN-PROCESS retry for errors the caller classifies as transient (e.g.
  // a brief Qdrant timeout) — deliberately not broker-level requeue: requeue
  // without a delivery-count/backoff mechanism (not configured anywhere in this
  // project) risks a hot loop against an outage that lasts longer than an
  // instant. Retrying inside the handler blocks one prefetch slot, which is an
  // acceptable trade for a caller-classified transient failure.
  maxProcessingAttempts?: number;
  retryBaseDelayMs?: number;
  // Classifies whether a thrown error is worth retrying at all. Left to the
  // caller (not decided here) because only the caller's handleMessage knows
  // what its own dependencies' transient-vs-permanent errors look like — this
  // module stays generic infra, same reasoning as handleMessage itself being
  // injected rather than hardcoded. Defaults to "never retryable", preserving
  // the exact original behavior (immediate nack, no retry) for existing
  // consumers that don't opt in (e.g. sampleConsumer.ts).
  isRetryableError?: (error: unknown) => boolean;
};

export class RabbitMqConsumer<Payload = unknown> implements Consumer {
  private abortController: AbortController | null = null;

  private channel: RabbitMqChannel | null = null;

  // Tracks every consumeMessage() call currently in flight — including ones sitting
  // in a retry backoff sleep — so stop() can wait for them to actually finish
  // (or be interrupted, see abortController) before it tears the channel down.
  // consumeMessage is invoked fire-and-forget from the raw amqplib consume()
  // callback (it can't be awaited there), so this Set is the only way stop() has
  // any visibility into "is something still processing right now".
  private readonly inFlight = new Set<Promise<void>>();

  private readonly deadLetterExchange: string | undefined;

  private readonly exchange: string;

  private readonly handleMessage: RabbitMqMessageHandler<Payload>;

  private readonly isRetryableError: (error: unknown) => boolean;

  private readonly maxProcessingAttempts: number;

  private readonly prefetch: number | undefined;

  private readonly queue: string;

  private readonly retryBaseDelayMs: number;

  private readonly routingKeyPatterns: readonly string[];

  constructor(
    private readonly rabbitmq: RabbitMqManager,
    options: RabbitMqConsumerOptions<Payload>,
  ) {
    this.deadLetterExchange = options.deadLetterExchange;
    this.exchange = options.exchange ?? DEFAULT_EXCHANGE;
    this.handleMessage = options.handleMessage;
    this.isRetryableError = options.isRetryableError ?? (() => false);
    this.maxProcessingAttempts = options.maxProcessingAttempts ?? 1;
    this.prefetch = options.prefetch;
    this.queue = options.queue;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.routingKeyPatterns =
      typeof options.routingKeyPattern === "string"
        ? [options.routingKeyPattern]
        : options.routingKeyPattern;
  }

  async start(): Promise<void> {
    if (this.channel?.isOpen()) {
      return;
    }

    this.abortController = new AbortController();

    this.channel = await this.rabbitmq.createChannel(async (channel) => {
      await channel.assertExchange(this.exchange, "topic", { durable: true });

      const queueArguments: Record<string, unknown> = {};

      if (this.deadLetterExchange) {
        // Fanout, not topic — a dead-letter queue's job is "catch everything
        // routed here", not further routing-key filtering.
        await channel.assertExchange(this.deadLetterExchange, "fanout", {
          durable: true,
        });

        const deadLetterQueue = `${this.queue}.dlq`;

        await channel.assertQueue(deadLetterQueue, { durable: true });
        await channel.bindQueue(deadLetterQueue, this.deadLetterExchange, "");

        queueArguments["x-dead-letter-exchange"] = this.deadLetterExchange;
      }

      await channel.assertQueue(this.queue, {
        durable: true,
        arguments: queueArguments,
      });
      // One bind per pattern. `bindQueue` is idempotent on the broker, so a
      // reconnect re-binding all of them costs nothing, and a partial failure
      // leaves the queue bound to the prefixes that did land — which is why the
      // loop is here and not a single call with a joined string: AMQP has no
      // syntax for "either of these two patterns" in one binding.
      for (const pattern of this.routingKeyPatterns) {
        await channel.bindQueue(this.queue, this.exchange, pattern);
      }

      if (this.prefetch !== undefined) {
        await channel.prefetch(this.prefetch);
      }

      await channel.consume(
        this.queue,
        (message) => {
          const task = this.consumeMessage(message);

          this.inFlight.add(task);
          void task.finally(() => {
            this.inFlight.delete(task);
          });
        },
        { noAck: false },
      );
    });
  }

  async stop(): Promise<void> {
    // Interrupt any retry backoff sleep immediately (fast shutdown, don't wait out
    // the full delay) — consumeMessage treats an interrupted sleep as "shutting
    // down", leaving the message unacked rather than touching the channel further.
    this.abortController?.abort();

    // Wait for whatever's currently in flight to actually settle before closing
    // the channel out from under it — this is what closes the race a message
    // mid-retry used to hit: without draining first, a message could still reach
    // its post-sleep ack/nack call after the channel it captured had already gone
    // null (see the safeAck/safeNack helper below for the other half of the fix).
    await Promise.all(this.inFlight);

    await this.channel?.close();
    this.channel = null;
    this.abortController = null;
  }

  private async consumeMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) {
      return;
    }

    // amqplib's own delivery callback (channel.consume() above) can still fire for a
    // message that was already in the pipe even after stop() has nulled this.channel and
    // closed it — closing a channel isn't synchronous with respect to already-dispatched
    // deliveries. Previously this called requireChannel() unconditionally here, which
    // THROWS for exactly this case — a throw with no catch around it (this is the first
    // line of the function, before any try/catch), from a promise that's fire-and-forget
    // at the call site (`void task.finally(...)` doesn't add a rejection handler to `task`
    // itself) — a real unhandled promise rejection, the same crash-risk class fixed for the
    // retry-sleep race, just at an earlier point in this same function. Same resolution:
    // leave the message unacked for redelivery instead of reaching for a channel that's
    // already gone.
    if (!this.channel) {
      logger.warn(
        { routingKey: message.fields.routingKey },
        "Message delivered after channel was already closed (shutdown race); leaving unacked for redelivery",
      );

      return;
    }

    const channel = this.channel;
    const routingKey = message.fields.routingKey;

    let payload: Payload;

    try {
      payload = JSON.parse(message.content.toString("utf8")) as Payload;
    } catch (error) {
      // A malformed payload will never parse differently on a later attempt —
      // never worth retrying, regardless of what isRetryableError says.
      logger.error(
        { err: error, routingKey },
        "Failed to parse RabbitMQ message payload; routing to dead-letter",
      );

      await this.settle(channel, "nack", message, routingKey);

      return;
    }

    for (let attempt = 1; attempt <= this.maxProcessingAttempts; attempt += 1) {
      try {
        await this.handleMessage({ payload, routingKey });

        await this.settle(channel, "ack", message, routingKey);

        return;
      } catch (error) {
        const attemptsRemain = attempt < this.maxProcessingAttempts;
        const retryable = this.isRetryableError(error);

        if (retryable && attemptsRemain) {
          logger.warn(
            { err: error, routingKey, attempt },
            "Retryable failure processing RabbitMQ message; retrying in-process",
          );

          try {
            await sleep(this.retryBaseDelayMs * 2 ** (attempt - 1), undefined, {
              signal: this.abortController?.signal,
            });
          } catch {
            // Interrupted by stop() — shutting down. Leave the message unacked
            // rather than reaching for a channel that's about to be (or already
            // has been) closed; RabbitMQ redelivers unacked messages once the
            // channel/connection actually closes, which is the correct outcome
            // here since we never finished processing this message.
            logger.warn(
              { routingKey, attempt },
              "Retry sleep interrupted by shutdown; leaving message unacked for redelivery",
            );

            return;
          }

          continue;
        }

        logger.error(
          { err: error, routingKey, attempt, retryable },
          retryable
            ? "Retryable failure exhausted all attempts; routing to dead-letter"
            : "Non-retryable failure processing RabbitMQ message; routing to dead-letter",
        );

        await this.settle(channel, "nack", message, routingKey);

        return;
      }
    }
  }

  // ack/nack can throw if the channel closed or was detached between when this
  // message started processing and now — either stop() draining past this point
  // anyway (a narrow window right after handleMessage resolves, before this call),
  // or RabbitMqManager's auto-reconnect detaching every tracked channel wrapper on
  // a connection drop (RabbitMqManager.detachChannels() nulls the exact wrapper
  // this method captured). Both are expected operational conditions, not bugs —
  // caught and logged here so they can never escape as an unhandled rejection out
  // of the fire-and-forget consume() callback (Node's default since v15 is to
  // crash the process on those).
  private async settle(
    channel: RabbitMqChannel,
    action: "ack" | "nack",
    message: ConsumeMessage,
    routingKey: string,
  ): Promise<void> {
    try {
      await channel.run((activeChannel) => {
        if (action === "ack") {
          activeChannel.ack(message);
        } else {
          activeChannel.nack(message, false, false);
        }
      });
    } catch (error) {
      logger.warn(
        { err: error, routingKey, action },
        "Channel unavailable while settling message (shutdown or reconnect in progress); message will be redelivered",
      );
    }
  }

}

export function createRabbitMqConsumer<Payload = unknown>(
  rabbitmq: RabbitMqManager,
  options: RabbitMqConsumerOptions<Payload>,
): RabbitMqConsumer<Payload> {
  return new RabbitMqConsumer(rabbitmq, options);
}
