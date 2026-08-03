import {
  QdrantClientResourceExhaustedError,
  QdrantClientTimeoutError,
} from "@qdrant/js-client-rest";
import { ApiError } from "@qdrant/openapi-typescript-fetch";

import { Prisma } from "../../generated/prisma/client.js";

// Classifier passed as `isRetryableError` to the embedding worker's Consumer
// (see infrastructure/queue/consumer.ts) — decides whether a failure from any
// step of §17 (Postgres load/write, Qdrant read/write, embedding provider
// call) is worth an in-process retry, or should go straight to dead-letter.
//
// Traced from the ACTUAL code each dependency throws, not assumed from a
// generic API surface — @qdrant/js-client-rest in particular does not simply
// throw one error shape with a `.status`:
//   - fetchJson() (@qdrant/openapi-typescript-fetch) throws `ApiError` (with a
//     real `.status: number`) for EVERY non-2xx response.
//   - api-client.js's middleware catches that and, ONLY for status 429 WITH a
//     `retry-after` header present, re-wraps it as
//     `QdrantClientResourceExhaustedError` — every other case (400, 404, 500,
//     503, and even 429 without the header) re-throws the original `ApiError`
//     unchanged, so `.status` is still there to check directly.
//   - A configured request timeout (AbortError) is wrapped as
//     `QdrantClientTimeoutError` — always transient by definition.
//   - A network-level failure before any HTTP response at all (Qdrant
//     unreachable, DNS blip) surfaces as a plain `TypeError` from Node's
//     fetch ("fetch failed"), wrapped by neither Qdrant nor Prisma.
export function isRetryableEmbeddingWorkerError(error: unknown): boolean {
  if (error instanceof QdrantClientResourceExhaustedError) {
    return true;
  }

  if (error instanceof ApiError) {
    return error.status >= 500 || error.status === 429;
  }

  if (error instanceof QdrantClientTimeoutError) {
    return true;
  }

  if (isNetworkLevelFetchFailure(error)) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientValidationError
  ) {
    return false;
  }

  // Default for everything else — embedding provider errors with no
  // structured shape across vendors (§ discussion, 05-implementation-policy/
  // 03_qdrant_point_id_chunking.md addendum reasoning), Prisma's own
  // PrismaClientUnknownRequestError/PrismaClientRustPanicError, and any
  // genuinely unrecognized exception: NOT retryable. Revised from an earlier
  // "permissive" default — a systemic failure (e.g. a bad deploy) would
  // otherwise hold every message's prefetch slot through a full backoff
  // before dead-lettering anyway, collapsing worker throughput during
  // exactly the outage it's meant to survive. Now that dead-lettering
  // actually lands somewhere inspectable (DLX, 5.2b), failing fast for
  // anything unrecognized costs nothing but a slightly less precise skip.
  return false;
}

function isNetworkLevelFetchFailure(error: unknown): boolean {
  return error instanceof TypeError && error.message === "fetch failed";
}
