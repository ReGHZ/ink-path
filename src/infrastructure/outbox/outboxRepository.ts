import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";

export type ClaimedOutboxEvent = {
  id: string;
  routingKey: string;
  payload: unknown;
  retryCount: number;
  maxRetries: number;
};

export class OutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claimDueEvents(
    batchSize: number,
    workerId: string,
  ): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$transaction(
      async (tx): Promise<ClaimedOutboxEvent[]> => {
        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM outbox_events
            WHERE
                status = 'pending'
                OR (
                status = 'failed'
                AND (next_retry_at IS NULL OR next_retry_at <= now())
                )
            ORDER BY created_at ASC
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
            `;

        const ids = lockedRows.map((row) => row.id);

        if (ids.length === 0) {
          return [];
        }

        await tx.outboxEvent.updateMany({
          where: { id: { in: ids } },
          data: {
            status: "processing",
            lockedAt: new Date(),
            lockedBy: workerId,
          },
        });

        return tx.outboxEvent.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            routingKey: true,
            payload: true,
            retryCount: true,
            maxRetries: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        });
      },
    );
  }

  async markPublished(eventId: string, workerId: string): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: "processing",
        lockedBy: workerId,
      },
      data: {
        status: "published",
        publishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    return result.count === 1;
  }

  async markFailed(parameters: {
    eventId: string;
    workerId: string;
    errorCode: string | null;
    errorMessage: string | null;
    nextRetryAt: Date;
  }): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        id: parameters.eventId,
        status: "processing",
        lockedBy: parameters.workerId,
      },
      data: {
        status: "failed",
        retryCount: { increment: 1 },
        nextRetryAt: parameters.nextRetryAt,
        lastErrorCode: parameters.errorCode,
        lastErrorMessage: parameters.errorMessage,
        lockedAt: null,
        lockedBy: null,
      },
    });
    return result.count === 1;
  }

  // 05-implementation-policy/04_stale_worker_recovery.md §2/§15 — a dispatcher process that
  // dies (crash, kill, container termination) between claimDueEvents() locking a row and one
  // of markPublished/markFailed/markDeadLettered releasing it leaves that row stuck in
  // `processing` forever: claimDueEvents only ever looks at `pending`/`failed`. This heals
  // that: `locked_at` older than the caller's staleness threshold is treated as an orphaned
  // lock, regardless of who `locked_by` says owns it (they're gone). Deliberately does NOT
  // increment retry_count here (unlike markFailed/markDeadLettered) — the policy text for
  // this specific recovery path never mentions it, because we genuinely don't know whether
  // the crashed worker's publish actually succeeded before it died (see §2's own idempotency
  // note); this path is "we lost track", not "we tried and failed".
  async recoverStaleLocks(
    staleBefore: Date,
    batchSize: number,
  ): Promise<{ recoveredToFailed: number; recoveredToDeadLetter: number }> {
    return this.prisma.$transaction(async (tx) => {
      const staleRows = await tx.$queryRaw<
        Array<{ id: string; retry_count: number; max_retries: number }>
      >`
        SELECT id, retry_count, max_retries
        FROM outbox_events
        WHERE status = 'processing' AND locked_at < ${staleBefore}
        ORDER BY locked_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (staleRows.length === 0) {
        return { recoveredToFailed: 0, recoveredToDeadLetter: 0 };
      }

      const toFailedIds = staleRows
        .filter((row) => row.retry_count < row.max_retries)
        .map((row) => row.id);
      const toDeadLetterIds = staleRows
        .filter((row) => row.retry_count >= row.max_retries)
        .map((row) => row.id);

      if (toFailedIds.length > 0) {
        await tx.outboxEvent.updateMany({
          where: { id: { in: toFailedIds } },
          data: {
            status: "failed",
            nextRetryAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: "STALE_OUTBOX_LOCK",
            lastErrorMessage:
              "Outbox event lock expired before publish completion",
          },
        });
      }

      for (const id of toDeadLetterIds) {
        const outboxEvent = await tx.outboxEvent.findUniqueOrThrow({
          where: { id },
        });

        await tx.outboxEvent.update({
          where: { id },
          data: {
            status: "dead_lettered",
            lockedAt: null,
            lockedBy: null,
            nextRetryAt: null,
            lastErrorCode: "STALE_OUTBOX_LOCK",
            lastErrorMessage:
              "Outbox event lock expired before publish completion; retries exhausted",
          },
        });

        await tx.deadLetterEvent.create({
          data: {
            outboxEventId: outboxEvent.id,
            rootOutboxEventId: outboxEvent.id,
            failureSource: "outbox_publish",

            eventType: outboxEvent.eventType,
            eventVersion: outboxEvent.eventVersion,

            aggregateType: outboxEvent.aggregateType,
            aggregateId: outboxEvent.aggregateId,

            projectId: outboxEvent.projectId,
            triggeredByUserId: outboxEvent.triggeredByUserId,

            exchange: outboxEvent.exchange,
            routingKey: outboxEvent.routingKey,

            payload: outboxEvent.payload as Prisma.InputJsonValue,

            retryCount: outboxEvent.retryCount,
            maxRetries: outboxEvent.maxRetries,

            lastErrorCode: "STALE_OUTBOX_LOCK",
            lastErrorMessage:
              "Outbox event lock expired before publish completion; retries exhausted",

            failedAt: new Date(),
          },
        });
      }

      return {
        recoveredToFailed: toFailedIds.length,
        recoveredToDeadLetter: toDeadLetterIds.length,
      };
    });
  }

  async markDeadLettered(parameters: {
    eventId: string;
    workerId: string;
    errorCode: string | null;
    errorMessage: string | null;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const outboxEvent = await tx.outboxEvent.findFirst({
        where: {
          id: parameters.eventId,
          status: "processing",
          lockedBy: parameters.workerId,
        },
      });

      if (!outboxEvent) {
        return false;
      }

      const updated = await tx.outboxEvent.updateMany({
        where: {
          id: parameters.eventId,
          status: "processing",
          lockedBy: parameters.workerId,
        },
        data: {
          status: "dead_lettered",
          retryCount: {
            increment: 1,
          },
          lastErrorCode: parameters.errorCode,
          lastErrorMessage: parameters.errorMessage,
          lockedAt: null,
          lockedBy: null,
          nextRetryAt: null,
        },
      });

      if (updated.count !== 1) {
        return false;
      }

      await tx.deadLetterEvent.create({
        data: {
          outboxEventId: outboxEvent.id,
          rootOutboxEventId: outboxEvent.id,
          failureSource: "outbox_publish",

          eventType: outboxEvent.eventType,
          eventVersion: outboxEvent.eventVersion,

          aggregateType: outboxEvent.aggregateType,
          aggregateId: outboxEvent.aggregateId,

          projectId: outboxEvent.projectId,
          triggeredByUserId: outboxEvent.triggeredByUserId,

          exchange: outboxEvent.exchange,
          routingKey: outboxEvent.routingKey,

          payload: outboxEvent.payload as Prisma.InputJsonValue,

          retryCount: outboxEvent.retryCount + 1,
          maxRetries: outboxEvent.maxRetries,

          lastErrorCode: parameters.errorCode,
          lastErrorMessage: parameters.errorMessage,

          failedAt: new Date(),
        },
      });

      return true;
    });
  }
}

export function createOutboxRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): OutboxRepository {
  return new OutboxRepository(prisma);
}
