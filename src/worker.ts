import { createAppContainer } from "./infrastructure/container.js";
import { logger } from "./infrastructure/logger.js";

const container = createAppContainer();
const rabbitmq = container.resolve("rabbitmq");
const outboxDispatcher = container.resolve("outboxDispatcher");

await rabbitmq.start();
await outboxDispatcher.start();

logger.info("Worker process running.");

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info(`Received ${signal}. Shutting down worker process.`);

  try {
    await outboxDispatcher.stop();
    logger.info("Outbox dispatcher stopped successfully.");
  } catch (disconnectError) {
    logger.error({ err: disconnectError }, "Failed to stop outbox dispatcher.");
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
