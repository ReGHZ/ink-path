import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../application/ports/OutboxEventRepository.js";

export type OutboxEventDatabase = Pick<PrismaClient, "outboxEvent">;

export class PrismaOutboxEventRepository implements OutboxEventRepository {
  constructor(private readonly client: OutboxEventDatabase) {}

  async insert(event: OutboxEvent): Promise<void> {
    await this.client.outboxEvent.create({
      data: {
        id: event.id,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        projectId: event.projectId,
        triggeredByUserId: event.triggeredByUserId,
        payload: event.payload as Prisma.InputJsonValue,
        routingKey: event.routingKey,
        exchange: event.exchange,
      },
    });
  }
}

export function createOutboxEventRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): OutboxEventRepository {
  return new PrismaOutboxEventRepository(prisma);
}
