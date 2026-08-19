import { createAppContainer } from "./infrastructure/container.js";
import { logger } from "./infrastructure/logger.js";

// Separate process from worker.ts, embeddingWorker.ts and outboxRecoveryWorker.ts
// (step 4b-4, stage C). The plan for this step had it SHARING worker.ts to save two
// files; that was reversed after reading what the existing processes actually say
// about themselves, and the reasons are worth writing down because the cheap version
// is tempting again every time a fifth consumer appears:
//
//   1. worker.ts is not a worker HOST. It starts exactly one thing — the outbox
//      dispatcher, the PUBLISH side. This projector consumes the very events that
//      dispatcher publishes, so co-locating them would put a consumer inside its own
//      producer's process: one poison-message loop or one crash in the fold would
//      stop event publication for the entire system, including the events the fold
//      itself is waiting for.
//   2. The rule this codebase already applies is failure domain + scaling, not
//      workload weight. embeddingWorker.ts states it in its own header: the dispatcher
//      and a content.* consumer "scale independently and have unrelated failure
//      modes; nothing requires them to share a process". Both halves of that apply
//      here unchanged. (The plan's rationale — that the embedding worker is separate
//      because model inference is heavy — is not what the code says.)
//   3. GraphProjector throws by design for anything it has no fold for, so that a
//      fact never goes missing in silence. Deliberately loud failures do not belong
//      in the process that everything else depends on.
//   4. Scaling worker.ts to get more projector throughput would also duplicate the
//      dispatcher, whose stale row locks are the exact thing outboxRecoveryWorker
//      exists to heal.
//
// The cost, stated: one more Prisma pool, one more AMQP connection, one more compose
// service and one more unit to supervise. Pre-deploy, with no connection budget tuned
// yet, that is cheap — and it is the same cost the two workers before this one paid.
const container = createAppContainer();
const rabbitmq = container.resolve("rabbitmq");
const graphProjectorConsumer = container.resolve("graphProjectorConsumer");

await rabbitmq.start();
await graphProjectorConsumer.start();

logger.info("Graph projector worker process running.");

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info(`Received ${signal}. Shutting down graph projector process.`);

  try {
    await graphProjectorConsumer.stop();
    logger.info("Graph projector consumer stopped successfully.");
  } catch (disconnectError) {
    logger.error(
      { err: disconnectError },
      "Failed to stop graph projector consumer.",
    );
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
