import { createProjectRoutes } from "../internal/interface/projectRoutes.js";
import { createUserProjectRoutes } from "../internal/interface/userProjectRoutes.js";

import type { ProjectScopedRouter } from "../../../shared/http/projectScopedRouter.js";
import type { ProjectDomainCradle } from "../register.js";
import type { AwilixContainer } from "awilix";

// See mountContentModule: the ProjectScopedRouter type carries the guarantee
// that auth + active-membership are already registered on this prefix, so these
// routers register no middleware of their own.
export function mountProjectModule(
  router: ProjectScopedRouter,
  container: AwilixContainer<ProjectDomainCradle>,
): void {
  router.route(
    "/",
    createProjectRoutes({
      projectController: container.resolve("projectController"),
    }),
  );

  router.route(
    "/",
    createUserProjectRoutes({
      userProjectController: container.resolve("userProjectController"),
    }),
  );
}
