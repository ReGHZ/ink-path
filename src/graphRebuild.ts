import { createAppContainer } from "./infrastructure/container.js";
import { logger } from "./infrastructure/logger.js";

// Runs the fold rebuild for one project: `pnpm graph:rebuild <projectId>`.
//
// A rebuild that cannot be RUN is not a recovery path, it is a method — and the whole
// argument for having one (gerbang 4b-4 G4-1) is that ordering damage in
// `evaluation_nodes`/`evaluation_edges` must be repairable rather than permanent. So the
// trigger lands with the method.
//
// A script rather than an HTTP route, deliberately: this drops and re-derives a whole
// project's projection, which is an operator action, not a tenant action. Exposing it on the
// API would need its own authorization story (who may rebuild whose project) — a decision
// nobody has asked for, and one this file does not quietly make.
//
// Not a worker process either: it does one bounded pass and exits, like a migration.
const projectId = process.argv[2];

if (!projectId) {
  logger.error("Usage: pnpm graph:rebuild <projectId>");
  process.exit(1);
}

const container = createAppContainer();
const graphProjector = container.resolve("graphProjector");
const prisma = container.resolve("prisma");

try {
  const outcome = await graphProjector.rebuildProject(projectId);

  // Counted, not just "done": "the log held 40 asserts and the graph got 37" is the line
  // that tells an operator whether the rebuild found something wrong or merely confirmed the
  // graph was already right.
  logger.info({ projectId, ...outcome }, "Evaluation graph rebuilt from the log.");
} catch (error) {
  // No RabbitMQ in this process, so nothing to dead-letter into: a failure here has to be
  // visible in the exit code, or a broken rebuild reads as a successful one in CI or in a
  // shell loop over projects.
  logger.error({ err: error, projectId }, "Evaluation graph rebuild failed.");
  await prisma.$disconnect();
  process.exit(1);
}

await prisma.$disconnect();
