import {
  createContainer,
  InjectionMode,
  asFunction,
  type AwilixContainer,
} from "awilix";

import { createPrismaClient } from "./database/prisma.js";
import { createEmbeddingWorker, type EmbeddingWorker } from "./embedding/EmbeddingWorker.js";
import { createEmbeddingWorkerConsumer } from "./embedding/embeddingWorkerConsumer.js";
import { createLocalEmbeddingProvider } from "./embedding/LocalEmbeddingProvider.js";
import { createPrismaAiUsageLogWriter } from "./embedding/PrismaAiUsageLogWriter.js";
import {
  createOutboxDispatcher,
  type OutboxDispatcher,
} from "./outbox/outboxDispatcher.js";
import {
  createOutboxRepository,
  type OutboxRepository,
} from "./outbox/outboxRepository.js";
import {
  createOutboxStaleLockRecoveryJob,
  type OutboxStaleLockRecoveryJob,
} from "./outbox/outboxStaleLockRecoveryJob.js";
import { createRabbitMqConnection } from "./queue/connection.js";
import {
  createRabbitMqPublisher,
  type RabbitMqPublisher,
} from "./queue/publisher.js";
import {
  createQdrantClient,
  createQdrantVectorIndex,
} from "./vector/QdrantVectorIndex.js";
import {
  registerContentDomain,
  type ContentDomainCradle,
} from "../domains/content/register.js";
import { registerProjectDomain, type ProjectDomainCradle } from "../domains/project/register.js";
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
import type { AiUsageLogWriter } from "../shared/application/ports/AiUsageLogWriter.js";
import type { Consumer } from "../shared/application/ports/Consumer.js";
import type { EmbeddingProvider } from "../shared/application/ports/EmbeddingProvider.js";
import type { VectorIndex } from "../shared/application/ports/VectorIndex.js";
import type { AppEnvironment } from "../shared/http/context.js";
import type { QdrantClient } from "@qdrant/js-client-rest";
import type { MiddlewareHandler } from "hono";

export type AppCradle = {
  prisma: PrismaClient;
  rabbitmq: RabbitMqManager;
  rabbitMqPublisher: RabbitMqPublisher;
  outboxRepository: OutboxRepository;
  outboxDispatcher: OutboxDispatcher;
  outboxStaleLockRecoveryJob: OutboxStaleLockRecoveryJob;
  jwtVerifier: JwtVerifier;
  authMiddleware: MiddlewareHandler<AppEnvironment>;
  qdrantClient: QdrantClient;
  vectorIndex: VectorIndex;
  embeddingProvider: EmbeddingProvider;
  aiUsageLogWriter: AiUsageLogWriter;
  embeddingWorker: EmbeddingWorker;
  embeddingWorkerConsumer: Consumer;
} & UserDomainCradle & ProjectDomainCradle & ContentDomainCradle

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
  container.register(
    "outboxStaleLockRecoveryJob",
    asFunction(createOutboxStaleLockRecoveryJob).singleton(),
  );
  container.register("jwtVerifier", asFunction(createJwtVerifier).singleton());
  container.register(
    "authMiddleware",
    asFunction(createAppAuthMiddleware).singleton(),
  );
  container.register("qdrantClient", asFunction(createQdrantClient).singleton());
  container.register(
    "vectorIndex",
    asFunction(createQdrantVectorIndex).singleton(),
  );
  container.register(
    "embeddingProvider",
    asFunction(createLocalEmbeddingProvider).singleton(),
  );
  container.register(
    "aiUsageLogWriter",
    asFunction(createPrismaAiUsageLogWriter).singleton(),
  );
  container.register(
    "embeddingWorker",
    asFunction(createEmbeddingWorker).singleton(),
  );
  container.register(
    "embeddingWorkerConsumer",
    asFunction(createEmbeddingWorkerConsumer).singleton(),
  );
  registerUserDomain(container);
  registerProjectDomain(container)
  registerContentDomain(container);

  return container;
}
