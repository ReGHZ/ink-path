import { errorResponse } from "./response.js";
import { logger } from "../../infrastructure/logger.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";
import { isTransientDatabaseError } from "../infrastructure/prismaErrors.js";

import type { AppEnvironment } from "./context.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const statusMap: Record<ErrorCode, ContentfulStatusCode> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.UNAVAILABLE]: 503,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

function mapErrorCodeToStatus(code: ErrorCode): ContentfulStatusCode {
  return statusMap[code];
}

export function handleError(error: unknown, c: Context<AppEnvironment>) {
  const requestId = c.get("requestId");

  if (error instanceof AppError) {
    logger.warn({ requestId, code: error.code }, error.message);

    return errorResponse(
      c,
      error.code,
      error.message,
      error.details,
      mapErrorCodeToStatus(error.code),
    );
  }

  // Contention, not a bug: the transaction was killed as a deadlock victim or
  // lost a serialization race, so nothing was committed and repeating the request
  // is the correct next move. Answered HERE — once, at the boundary every route
  // shares — rather than in a domain error mapper, because the condition belongs
  // to the database transport and is identical for all of them. Mapping it per
  // domain is the shape this project already rejected for this exact error
  // (`notes/tech-debt.md` §Deadlock Postgres `40P01`).
  //
  // `warn`, not `error`: it needs its own counter, not the bug alarm. And the
  // classifier is the SHARED one the fold and reader paths use, so "what counts as
  // retryable" cannot drift between the HTTP boundary and the workers.
  if (isTransientDatabaseError(error)) {
    logger.warn({ requestId, err: error }, "Transient database contention");

    // Seconds, and small on purpose: a deadlock victim is already dead, so the
    // lock it waited for is gone by now. This is a floor against hammering, not
    // an estimate of when the server will be healthy.
    c.header("Retry-After", "1");

    return errorResponse(
      c,
      ErrorCode.UNAVAILABLE,
      "The database refused this attempt because of concurrent contention. Nothing was written — retry the request.",
      undefined,
      503,
    );
  }

  logger.error({ requestId, err: error }, "Unhandled error");

  return errorResponse(
    c,
    ErrorCode.INTERNAL_ERROR,
    "Internal server error",
    undefined,
    500,
  );
}
