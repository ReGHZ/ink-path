import {
  createContainer,
  InjectionMode,
  asFunction,
  type AwilixContainer,
} from "awilix";

import { createPrismaClient } from "./database/prisma.js";
import {
  createOutboxDispatcher,
  type OutboxDispatcher,
} from "./outbox/outboxDispatcher.js";
import {
  createOutboxRepository,
  type OutboxRepository,
} from "./outbox/outboxRepository.js";
import { createRabbitMqConnection } from "./queue/connection.js";
import {
  createRabbitMqPublisher,
  type RabbitMqPublisher,
} from "./queue/publisher.js";

import type { RabbitMqManager } from "./queue/rabbitmqManager.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export type AppCradle = {
  prisma: PrismaClient;
  rabbitmq: RabbitMqManager;
  rabbitMqPublisher: RabbitMqPublisher;
  outboxRepository: OutboxRepository;
  outboxDispatcher: OutboxDispatcher;
};

export function createAppContainer(): AwilixContainer<AppCradle> {
  const container = createContainer<AppCradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register("prisma", asFunction(createPrismaClient).singleton());
  container.register(
    "rabbitmq",
    asFunction(createRabbitMqConnection).singleton(),
  );
  container.register(
    "rabbitMqPublisher",
    asFunction(createRabbitMqPublisher).singleton(),
  );
  container.register(
    "outboxRepository",
    asFunction(createOutboxRepository).singleton(),
  );
  container.register(
    "outboxDispatcher",
    asFunction(createOutboxDispatcher).singleton(),
  );

  return container;
}
