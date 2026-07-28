import { createCharacterRoutes } from "../internal/interface/story/characterRoutes.js";
import { createFactionRoutes } from "../internal/interface/story/factionRoutes.js";
import { createLayerRoutes } from "../internal/interface/world/layerRoutes.js";
import { createWorldElementRoutes } from "../internal/interface/world/worldElementRoutes.js";
import { createWorldMapRoutes } from "../internal/interface/world/worldMapRoutes.js";

import type { AppEnvironment } from "../../../shared/http/context.js";
import type { ContentDomainCradle } from "../register.js";
import type { AwilixContainer } from "awilix";
import type { Hono, MiddlewareHandler } from "hono";

type ContentModuleCradle = ContentDomainCradle & {
  authMiddleware: MiddlewareHandler<AppEnvironment>;
  projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
};

export function mountContentModule(
  router: Hono<AppEnvironment>,
  container: AwilixContainer<ContentModuleCradle>,
): void {
  const authMiddleware = container.resolve("authMiddleware");
  const projectMemberMiddleware = container.resolve("projectMemberMiddleware");

  router.route(
    "/projects",
    createLayerRoutes({
      layerController: container.resolve("layerController"),
      authMiddleware,
      projectMemberMiddleware,
    }),
  );

  router.route(
    "/projects",
    createWorldMapRoutes({
      worldMapController: container.resolve("worldMapController"),
      authMiddleware,
      projectMemberMiddleware,
    }),
  );

  router.route(
    "/projects",
    createWorldElementRoutes({
      worldElementController: container.resolve("worldElementController"),
      authMiddleware,
      projectMemberMiddleware,
    }),
  );

  router.route(
    "/projects",
    createFactionRoutes({
      factionController: container.resolve("factionController"),
      authMiddleware,
      projectMemberMiddleware,
    }),
  );

  router.route(
    "/projects",
    createCharacterRoutes({
      characterController: container.resolve("characterController"),
      authMiddleware,
      projectMemberMiddleware,
    }),
  );
}
