import type { AppEnvironment } from "./context.js";
import type { ErrorCode } from "../errors/ErrorCode.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function success(
  c: Context<AppEnvironment>,
  data: unknown,
  status: ContentfulStatusCode = 200,
) {
  return c.json(
    {
      data,
      meta: {
        requestId: c.get("requestId"),
      },
    },
    status,
  );
}

export function paginated(
  c: Context<AppEnvironment>,
  payload: {
    items: unknown;
    page: number;
    limit: number;
    totalItems: number;
  },
) {
  const totalPages = Math.ceil(payload.totalItems / payload.limit);
  const hasNextPage = payload.page < totalPages;
  const hasPreviousPage = payload.page > 1;

  return c.json({
    data: payload.items,
    meta: {
      requestId: c.get("requestId"),
      page: payload.page,
      limit: payload.limit,
      totalItems: payload.totalItems,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    },
  });
}

export function errorResponse(
  c: Context<AppEnvironment>,
  code: ErrorCode,
  message: string,
  details?: unknown,
  status: ContentfulStatusCode = 500,
) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
        requestId: c.get("requestId"),
      },
    },
    status,
  );
}
