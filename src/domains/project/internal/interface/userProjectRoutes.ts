import { Hono, type MiddlewareHandler } from "hono";

import type { UserProjectController } from "./UserProjectController.js";
import type { AppEnvironment } from "../../../../shared/http/context.js";

export function createUserProjectRoutes({
    userProjectController,
    authMiddleware,
    projectMemberMiddleware,
}: {
    userProjectController: UserProjectController;
    authMiddleware: MiddlewareHandler<AppEnvironment>;
    projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
}) {
    const routes = new Hono<AppEnvironment>({ strict: true });

    routes.use("*", authMiddleware);
    routes.use("/:projectId/*", projectMemberMiddleware);

    routes.get("/:projectId/members", (c) =>
        userProjectController.listMembers(c),
    );
    routes.patch("/:projectId/members/:userId", (c) =>
        userProjectController.changeMemberRole(c),
    );

    return routes;
}
