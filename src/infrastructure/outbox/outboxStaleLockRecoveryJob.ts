import { setTimeout as sleep } from "node:timers/promises";

import { logger } from "../logger.js";

import type { OutboxRepository } from "./outboxRepository.js";

type OutboxStaleLockRecoveryJobOptions = {
  pollIntervalMs?: number;
  staleThresholdMs?: number;
  batchSize?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_STALE_THRESHOLD_MS = 5 * 60_000;
const DEFAULT_BATCH_SIZE = 10;

// 05-implementation-policy/04_stale_worker_recovery.md §2/§15 — heals `outbox_events` rows
// left stuck in `processing` by a dispatcher process that died before releasing its lock.
// Same start()/stop()-loop shape as OutboxDispatcher (deliberately not a shared interface —
// OutboxDispatcher itself doesn't implement one either; a Consumer port exists in this
// codebase, but it's specifically for RabbitMQ message consumers, and this isn't one).
export class OutboxStaleLockRecoveryJob {
  private running = false;
  private loop: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  private readonly pollIntervalMs: number;
  private readonly staleThresholdMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    options: OutboxStaleLockRecoveryJobOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  start(): Promise<void> {
    if (this.running) return Promise.resolve();

    this.running = true;
    this.abortController = new AbortController();
    this.loop = this.runLoop();

    return Promise.resolve();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();

    await this.loop;
    this.loop = null;
    this.abortController = null;
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

        logger.error({ err: error }, "Outbox stale-lock recovery run failed");
      }
    }
  }

  private async runOnce(): Promise<void> {
    const staleBefore = new Date(Date.now() - this.staleThresholdMs);
    const result = await this.outboxRepository.recoverStaleLocks(
      staleBefore,
      this.batchSize,
    );

    if (result.recoveredToFailed > 0 || result.recoveredToDeadLetter > 0) {
      logger.warn(
        {
          recoveredToFailed: result.recoveredToFailed,
          recoveredToDeadLetter: result.recoveredToDeadLetter,
          staleBefore,
        },
        "Recovered outbox events stuck in processing (stale lock)",
      );
    }
  }
}

export function createOutboxStaleLockRecoveryJob({
  outboxRepository,
}: {
  outboxRepository: OutboxRepository;
}): OutboxStaleLockRecoveryJob {
  return new OutboxStaleLockRecoveryJob(outboxRepository);
}
