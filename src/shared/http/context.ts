import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { AppCradle } from "../../infrastructure/container.js";
import type { AwilixContainer } from "awilix";
import type { Context } from "hono";

export type ProjectMemberInfo = {
  userId: string;
  role: "writer" | "editor" | "reviewer";
  canDelete: boolean;
  aiAccess: "none" | "limited" | "full";
};

export type AppEnvironment = {
  Variables: {
    requestId: string;
    container: AwilixContainer<AppCradle>;
    userId?: string;
    projectMember?: ProjectMemberInfo;
  };
};

export function requireUserId(c: Context<AppEnvironment>): string {
  const userId = c.get("userId");

  if (!userId) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized");
  }

  return userId;
}

export function requireProjectMember(c: Context<AppEnvironment>): ProjectMemberInfo {
  const member = c.get("projectMember");

  if (!member) {
    throw new AppError(ErrorCode.NOT_FOUND, "Project not found");
  }

  return member;
}
