import { Hono, type MiddlewareHandler } from "hono";

import type { ProjectController } from "./ProjectController.js";
import type { AppEnvironment } from "../../../../shared/http/context.js";

export function createProjectRoutes({
    projectController,
    authMiddleware,
    projectMemberMiddleware,
}: {
    projectController: ProjectController;
    authMiddleware: MiddlewareHandler<AppEnvironment>;
    projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
}) {
    const routes = new Hono<AppEnvironment>({ strict: true });

    routes.use("*", authMiddleware);
    routes.use("/:projectId", projectMemberMiddleware);
    routes.use("/:projectId/*", projectMemberMiddleware);

    routes.post("/", (c) =>
        projectController.createProject(c),
    );
    routes.get("/:projectId", (c) => projectController.getProject(c));
    routes.patch("/:projectId", (c) =>
        projectController.updateProjectDetails(c),
    );
    routes.patch("/:projectId/activate", (c) =>
        projectController.activateProject(c),
    );
    routes.patch("/:projectId/archive", (c) =>
        projectController.archiveProject(c),
    );
    routes.patch("/:projectId/visibility", (c) =>
        projectController.changeProjectVisibility(c),
    );

    return routes;
}
