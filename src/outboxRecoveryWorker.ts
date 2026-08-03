import { createAppContainer } from "./infrastructure/container.js";
import { logger } from "./infrastructure/logger.js";

// Separate process from worker.ts and embeddingWorker.ts (05-implementation-policy/
// 04_stale_worker_recovery.md §2/§15) — deliberately independent so it can keep detecting
// and healing a stuck `outbox_events` row even if worker.ts's own process (the one that
// created the stale lock in the first place) has crashed. A recovery job living inside the
// same process as what it watches can't do that: it dies at the exact moment it would be
// needed most. No RabbitMQ dependency at all — this only ever touches Postgres.
const container = createAppContainer();
const outboxStaleLockRecoveryJob = container.resolve("outboxStaleLockRecoveryJob");

await outboxStaleLockRecoveryJob.start();

logger.info("Outbox stale-lock recovery worker process running.");

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info(`Received ${signal}. Shutting down outbox recovery worker process.`);

  try {
    await outboxStaleLockRecoveryJob.stop();
    logger.info("Outbox stale-lock recovery job stopped successfully.");
  } catch (disconnectError) {
    logger.error(
      { err: disconnectError },
      "Failed to stop outbox stale-lock recovery job.",
    );
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
