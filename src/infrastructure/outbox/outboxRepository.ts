import type { PrismaClient } from "../../generated/prisma/client.js";

export type ClaimedOutboxEvent = {
  id: string;
  routingKey: string;
  payload: unknown;
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
}

export function createOutboxRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): OutboxRepository {
  return new OutboxRepository(prisma);
}
