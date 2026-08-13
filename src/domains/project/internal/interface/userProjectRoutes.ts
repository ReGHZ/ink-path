import { Hono } from "hono";

import type { UserProjectController } from "./UserProjectController.js";
import type { AppEnvironment } from "../../../../shared/http/context.js";

export function createUserProjectRoutes({
    userProjectController,
}: {
    userProjectController: UserProjectController;
}) {
    const routes = new Hono<AppEnvironment>({ strict: true });

    routes.get("/:projectId/members", (c) =>
        userProjectController.listMembers(c),
    );
    routes.patch("/:projectId/members/:userId", (c) =>
        userProjectController.changeMemberRole(c),
    );

    return routes;
}
