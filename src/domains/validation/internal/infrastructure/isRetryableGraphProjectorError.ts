import { EvaluationGraphTransientError } from "../domain/EvaluationGraphError.js";

// The projector's retry policy, passed as `isRetryableError` to its Consumer
// (`infrastructure/queue/consumer.ts`).
//
// It reads a DOMAIN error, not a Prisma code — the adapters translate at the port
// boundary (`PrismaEvaluationGraphRepository`, `PrismaAssertionLogReader`), the same
// way every repository in this codebase translates a vendor error into something its
// callers can branch on. The embedding worker's classifier does read vendor shapes
// directly, and that is not the pattern to copy here: it lives outside every domain,
// in `src/infrastructure/embedding/`, and classifies three unrelated vendors
// (Qdrant, Prisma, plain fetch) with no port between them.
//
// Everything not named here is NON-retryable, and that default is the design:
//
//   · a routing key or effect type the fold has no branch for
//   · an event naming an assertion the log does not have
//   · a foreign key refusing a predicate the project never defined
//   · a unary fact, which has no home in the fold yet
//
// None of those change on a second attempt. Three more tries would only delay the
// dead-letter a human has to look at — and the DLQ is exactly where a fact missing
// from the graph becomes visible instead of silent.
export function isRetryableGraphProjectorError(error: unknown): boolean {
  return error instanceof EvaluationGraphTransientError;
}
