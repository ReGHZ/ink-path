import { createAppContainer } from "./infrastructure/container.js";
import { logger } from "./infrastructure/logger.js";

// Separate process from worker.ts (.ai/current.md, Phase 5.2c) — the outbox dispatcher
// (publish side) and the embedding worker (a content.* consumer) scale independently and
// have unrelated failure modes; nothing requires them to share a process.
const container = createAppContainer();
const rabbitmq = container.resolve("rabbitmq");
const vectorIndex = container.resolve("vectorIndex");
const embeddingWorkerConsumer = container.resolve("embeddingWorkerConsumer");

await rabbitmq.start();
// Idempotent (QdrantVectorIndex.ensureCollection) — safe to call on every startup.
await vectorIndex.ensureCollection();
await embeddingWorkerConsumer.start();

logger.info("Embedding worker process running.");

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info(`Received ${signal}. Shutting down embedding worker process.`);

  try {
    await embeddingWorkerConsumer.stop();
    logger.info("Embedding worker consumer stopped successfully.");
  } catch (disconnectError) {
    logger.error({ err: disconnectError }, "Failed to stop embedding worker consumer.");
  }

  try {
    await rabbitmq.stop();
    logger.info("RabbitMQ manager stopped successfully.");
  } catch (disconnectError) {
    logger.error({ err: disconnectError }, "Failed to stop RabbitMQ manager.");
  }

  try {
    const prisma = container.resolve("prisma");
    await prisma.$disconnect();
    logger.info("Prisma disconnected successfully.");
  } catch (disconnectError) {
    logger.error({ err: disconnectError }, "Failed to disconnect Prisma.");
  }

  process.exit(0);
}

process.on("SIGINT", (signal) => {
  void shutdown(signal);
});

process.on("SIGTERM", (signal) => {
  void shutdown(signal);
});
