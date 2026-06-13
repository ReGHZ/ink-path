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
import {
  registerUserDomain,
  type UserDomainCradle,
} from "../domains/user/register.js";
import { createJwtVerifier } from "../shared/auth/JoseJwtVerifier.js";
import {
  createAppAuthMiddleware,
  type JwtVerifier,
} from "../shared/middleware/AuthMiddleware.js";

import type { RabbitMqManager } from "./queue/rabbitmqManager.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AppEnvironment } from "../shared/http/context.js";
import type { MiddlewareHandler } from "hono";

export type AppCradle = {
  prisma: PrismaClient;
  rabbitmq: RabbitMqManager;
  rabbitMqPublisher: RabbitMqPublisher;
  outboxRepository: OutboxRepository;
  outboxDispatcher: OutboxDispatcher;
  jwtVerifier: JwtVerifier;
  authMiddleware: MiddlewareHandler<AppEnvironment>;
} & UserDomainCradle;

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
  container.register("jwtVerifier", asFunction(createJwtVerifier).singleton());
  container.register(
    "authMiddleware",
    asFunction(createAppAuthMiddleware).singleton(),
  );
  registerUserDomain(container);

  return container;
}
