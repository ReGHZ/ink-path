import { AppError } from "../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";
import { requireUserId, type AppEnvironment, type ProjectMemberInfo } from "../../../../shared/http/context.js";

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

    if (!projectId) {
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
