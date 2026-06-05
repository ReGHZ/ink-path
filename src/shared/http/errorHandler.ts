import { errorResponse } from "./response.js";
import { logger } from "../../infrastructure/logger.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { AppEnvironment } from "./context.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const statusMap: Record<ErrorCode, ContentfulStatusCode> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
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

  logger.error({ requestId, err: error }, "Unhandled error");

  return errorResponse(
    c,
    ErrorCode.INTERNAL_ERROR,
    "Internal server error",
    undefined,
    500,
  );
}
