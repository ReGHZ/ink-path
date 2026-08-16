import { AppError } from "../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";
import { isCanonicalUuid, requireUserId, type AppEnvironment, type ProjectMemberInfo } from "../../../../shared/http/context.js";

import type { MiddlewareHandler } from "hono";

export type { ProjectMemberInfo };

export type ProjectMemberProvider = {
  getActiveMember(
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberInfo | null>;
};

export function createProjectMemberMiddleware(
  provider: ProjectMemberProvider,
): MiddlewareHandler<AppEnvironment> {
  return async (c, next) => {
    const userId = requireUserId(c);
    const projectId = c.req.param("projectId");

    // Not a second copy of the routing rule: `uuidRouteParameterMiddleware`
    // (`shared/http/projectScopedRouter.ts`) enforces the shape of every path id
    // on this surface, but it is registered AFTER this middleware, and this one
    // hands `projectId` straight to `getActiveMember` — a Prisma query on a
    // `@db.Uuid` column, which answers a malformed value with P2007 and a 500.
    // So this guard defends the input of the query below, which is also what
    // keeps this middleware correct if it is ever mounted on a router that has
    // not installed the other one.
    //
    // Same 404 as an absent or foreign project id: the membership boundary must
    // not answer differently depending on the SHAPE of the id either.
    if (!projectId || !isCanonicalUuid(projectId)) {
      throw new AppError(ErrorCode.NOT_FOUND, "Project not found");
    }

    const member = await provider.getActiveMember(projectId, userId);

    if (!member) {
      throw new AppError(ErrorCode.NOT_FOUND, "Project not found");
    }

    c.set("projectMember", member);

    await next();
  };
}

export function createAppProjectMemberMiddleware({
  projectMemberProvider,
}: {
  projectMemberProvider: ProjectMemberProvider;
}): MiddlewareHandler<AppEnvironment> {
  return createProjectMemberMiddleware(projectMemberProvider);
}
