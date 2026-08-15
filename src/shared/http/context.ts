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

// Every content/project id lives in a `@db.Uuid` column. A malformed value
// handed to Prisma raises `P2007` (verified 2026-08-15 against real Postgres for
// findUnique/findFirst/findMany/deleteMany alike), and no error mapper in this
// codebase translates it — `prismaErrors.ts` knows only P2002/P2003/P2025 — so
// it reached the client as a 500: a client mistake reported as a server fault,
// which any retry-on-5xx caller would repeat forever and which pollutes the
// very 5xx signal used to page on real incidents.
//
// Fixed at the EDGE rather than by mapping Prisma codes in the error handler:
// P2007 is a generic "data validation error", so mapping it wholesale to 4xx
// would swallow other failures that genuinely are ours.
//
// 404 rather than 400, matching `requireRouteParameter` above: a path segment is
// a resource identity, and a syntactically impossible id addresses nothing. It
// also keeps the tenant-boundary discipline intact — the answer for "malformed",
// "absent" and "someone else's" stays identical, so no shape of id can be used
// to probe what exists. Ids that arrive in a request BODY are data fields, not
// identity, and stay 400 via their Zod schema (`z.uuid()`).
export function requireUuidRouteParameter(
  c: Context<AppEnvironment>,
  parameterName: string,
  notFoundMessage: string,
): string {
  const value = requireRouteParameter(c, parameterName, notFoundMessage);

  if (!isCanonicalUuid(value)) {
    throw new AppError(ErrorCode.NOT_FOUND, notFoundMessage);
  }

  return value;
}

export function requireProjectMember(
  c: Context<AppEnvironment>,
): ProjectMemberInfo {
  const member = c.get("projectMember");

  if (!member) {
    throw new AppError(ErrorCode.NOT_FOUND, "Project not found");
  }

  return member;
}
