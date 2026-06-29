import { setTimeout as sleep } from "node:timers/promises";

import { logger } from "../logger.js";

import type {
  ClaimedOutboxEvent,
  OutboxRepository,
} from "./outboxRepository.js";
import type { RabbitMqPublisher } from "../queue/publisher.js";

type OutboxDispatcherOptions = {
  workerId: string;
  batchSize?: number;
  pollIntervalMs?: number;

  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
};

export class OutboxDispatcher {
  private running = false;
  private loop: Promise<void> | null = null;

  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly workerId: string;

  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly publisher: RabbitMqPublisher,
    options: OutboxDispatcherOptions,
  ) {
    this.workerId = options.workerId;
    this.batchSize = options.batchSize ?? 10;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;

    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 30_000;
  }

  private abortController: AbortController | null = null;

  private calculateNextRetryAt(retryCount: number): Date {
    const exponent = Math.max(retryCount - 1, 0);

    const delayMs = Math.min(
      this.retryBaseDelayMs * 2 ** exponent,
      this.retryMaxDelayMs,
    );

    return new Date(Date.now() + delayMs);
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.abortController = new AbortController();
    await this.publisher.start();

    this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();

    await this.loop;
    this.loop = null;
    this.abortController = null;

    await this.publisher.stop();
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
        await sleep(this.pollIntervalMs, undefined, {
          signal: this.abortController?.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        logger.error({ err: error }, "Outbox dispatcher run failed");
      }
    }
  }

  private async runOnce(): Promise<void> {
    const events = await this.outboxRepository.claimDueEvents(
      this.batchSize,
      this.workerId,
    );

    for (const event of events) {
      await this.publishEvent(event);
    }
  }

  private async publishEvent(event: ClaimedOutboxEvent): Promise<void> {
    try {
      const published = await this.publisher.publish(
        event.routingKey,
        event.payload,
      );

      if (!published) {
        throw new Error("RabbitMQ publish returned false");
      }

      const markedPublished = await this.outboxRepository.markPublished(
        event.id,
        this.workerId,
      );

      if (!markedPublished) {
        logger.warn(
          { outboxEventId: event.id, workerId: this.workerId },
          "Outbox event publish succeeded but published status was not updated",
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const nextRetryCount = event.retryCount + 1;
      const exhausted = nextRetryCount >= event.maxRetries;

      logger.error(
        {
          err: error,
          outboxEventId: event.id,
          workerId: this.workerId,
          retryCount: nextRetryCount,
          maxRetries: event.maxRetries,
        },
        exhausted
          ? "Failed to publish outbox event; moving to dead letter"
          : "Failed to publish outbox event; scheduling retry",
      );

      if (exhausted) {
        const markedDeadLettered = await this.outboxRepository.markDeadLettered(
          {
            eventId: event.id,
            workerId: this.workerId,
            errorCode: "OUTBOX_PUBLISH_FAILED",
            errorMessage,
          },
        );

        if (!markedDeadLettered) {
          logger.warn(
            {
              outboxEventId: event.id,
              workerId: this.workerId,
            },
            "Outbox event publish failed but dead-letter status was not updated",
          );
        }
      } else {
        const markedFailed = await this.outboxRepository.markFailed({
          eventId: event.id,
          workerId: this.workerId,
          errorCode: "OUTBOX_PUBLISH_FAILED",
          errorMessage,
          nextRetryAt: this.calculateNextRetryAt(nextRetryCount),
        });

        if (!markedFailed) {
          logger.warn(
            {
              outboxEventId: event.id,
              workerId: this.workerId,
            },
            "Outbox event publish failed but failed status was not updated",
          );
        }
      }
    }
  }
}

export function createOutboxDispatcher({
  outboxRepository,
  rabbitMqPublisher,
}: {
  outboxRepository: OutboxRepository;
  rabbitMqPublisher: RabbitMqPublisher;
}): OutboxDispatcher {
  return new OutboxDispatcher(outboxRepository, rabbitMqPublisher, {
    workerId:
      process.env.OUTBOX_DISPATCHER_WORKER_ID ?? `worker-${process.pid}`,
  });
}
