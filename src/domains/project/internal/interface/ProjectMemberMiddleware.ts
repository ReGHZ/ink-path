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

    // The uuid check belongs HERE, not in each handler: this middleware runs for
    // every `/projects/:projectId/*` route (`projectScopedRouter.ts:46`), so one
    // guard covers all of them at once — and it is the only place that can,
    // because a malformed `:projectId` fails inside `getActiveMember` before any
    // handler is reached. Same 404 as an absent or foreign project id: the
    // membership boundary must not answer differently depending on the SHAPE of
    // the id either.
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
