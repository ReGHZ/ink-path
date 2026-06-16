import { createProjectRoutes } from "../internal/interface/projectRoutes.js";
import { createUserProjectRoutes } from "../internal/interface/userProjectRoutes.js";

import type { AppEnvironment } from "../../../shared/http/context.js";
import type { ProjectDomainCradle } from "../register.js";
import type { AwilixContainer } from "awilix";
import type { Hono, MiddlewareHandler } from "hono";

type ProjectModuleCradle = ProjectDomainCradle & {
  authMiddleware: MiddlewareHandler<AppEnvironment>;
};

export function mountProjectModule(
  router: Hono<AppEnvironment>,
  container: AwilixContainer<ProjectModuleCradle>,
): void {
  const authMiddleware = container.resolve("authMiddleware");
  const projectMemberMiddleware = container.resolve("projectMemberMiddleware");

  router.route(
    "/projects",
    createProjectRoutes({
      projectController: container.resolve("projectController"),
      authMiddleware,
      projectMemberMiddleware,
    }),
  );

  router.route(
    "/projects",
    createUserProjectRoutes({
      userProjectController: container.resolve("userProjectController"),
      authMiddleware,
      projectMemberMiddleware,
    }),
  );
}
