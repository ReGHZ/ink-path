import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { AppCradle } from "../../infrastructure/container.js";
import type { AwilixContainer } from "awilix";
import type { Context } from "hono";

export type AppEnvironment = {
  Variables: {
    requestId: string;
    container: AwilixContainer<AppCradle>;
    userId?: string;
  };
};

export function requireUserId(c: Context<AppEnvironment>): string {
  const userId = c.get("userId");

  if (!userId) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized");
  }

  return userId;
}
