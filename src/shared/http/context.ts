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
export function requireTargetUserId(c: Context<AppEnvironment>): string {
  const userId = c.req.param("userId");

  if (!userId) {
    throw new AppError(ErrorCode.NOT_FOUND, "User not found");
  }

  return userId;
}

export function requireProjectId(c: Context<AppEnvironment>): string {
  const projectId = c.req.param("projectId");

  if (!projectId) {
    throw new AppError(ErrorCode.NOT_FOUND, "Project not found");
  }

  return projectId;
}

export function requireRouteParameter(
  c: Context<AppEnvironment>,
  parameterName: string,
  notFoundMessage: string,
): string {
  const value = c.req.param(parameterName);
  if (!value) throw new AppError(ErrorCode.NOT_FOUND, notFoundMessage);
  return value;
}

// Canonical 8-4-4-4-12 hex form only — deliberately stricter than Postgres,
// which also accepts braced and dash-less literals. The target is not "whatever
// Postgres would parse" but "whatever `UuidGenerator` produces", and Prisma
// itself validates client-side to the same canonical form. Version and variant
// nibbles are NOT checked: they are a property of how an id was minted, not of
// whether it can address a row, and rejecting them would refuse ids seeded by
// other tools.
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID.test(value);
}

// Its only consumer is `uuidRouteParameterMiddleware` (`projectScopedRouter.ts`),
// which enforces the shape ONCE for the whole `/projects` surface. A
// `requireUuidRouteParameter()` helper lived here between 2026-08-15 and
// 2026-08-16 and was called per handler; it was removed when the middleware took
// over, because two mechanisms for one rule leave the next reader guessing which
// is authoritative — and the per-call version could only ever cover the handlers
// someone remembered to change. Why the rule exists at all (P2007 → 500) and why
// it answers 404 rather than 400 is documented at that middleware.
//
// `ProjectMemberMiddleware` keeps its OWN check for `:projectId`: it must answer
// before membership is resolved, which is upstream of the middleware above.

export function requireProjectMember(
  c: Context<AppEnvironment>,
): ProjectMemberInfo {
  const member = c.get("projectMember");

  if (!member) {
    throw new AppError(ErrorCode.NOT_FOUND, "Project not found");
  }

  return member;
}
