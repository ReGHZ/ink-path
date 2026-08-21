import { createChapterRoutes } from "../internal/interface/story/chapterRoutes.js";
import { createCharacterRoutes } from "../internal/interface/story/characterRoutes.js";
import { createFactionRoutes } from "../internal/interface/story/factionRoutes.js";
import { createPlotRoutes } from "../internal/interface/story/plotRoutes.js";
import { createSceneRoutes } from "../internal/interface/story/sceneRoutes.js";
import { createRelationshipRoutes } from "../internal/interface/support/relationshipRoutes.js";
import { createNarrativeTransitionRoutes } from "../internal/interface/transition/narrativeTransitionRoutes.js";
import { createEventRoutes } from "../internal/interface/world/eventRoutes.js";
import { createLayerRoutes } from "../internal/interface/world/layerRoutes.js";
import { createWorldElementRoutes } from "../internal/interface/world/worldElementRoutes.js";
import { createWorldMapRoutes } from "../internal/interface/world/worldMapRoutes.js";

import type { ProjectScopedRouter } from "../../../shared/http/projectScopedRouter.js";
import type { ContentDomainCradle } from "../register.js";
import type { AwilixContainer } from "awilix";

// `router` is a ProjectScopedRouter, not a plain Hono: the type is the proof
// that authentication and the active-membership check are already registered on
// this prefix. Content routers therefore declare no middleware of their own —
// they are route tables and nothing else.
export function mountContentModule(
  router: ProjectScopedRouter,
  container: AwilixContainer<ContentDomainCradle>,
): void {
  router.route(
    "/",
    createLayerRoutes({ layerController: container.resolve("layerController") }),
  );

  router.route(
    "/",
    createWorldMapRoutes({
      worldMapController: container.resolve("worldMapController"),
    }),
  );

  router.route(
    "/",
    createWorldElementRoutes({
      worldElementController: container.resolve("worldElementController"),
    }),
  );

  router.route(
    "/",
    createFactionRoutes({
      factionController: container.resolve("factionController"),
    }),
  );

  router.route(
    "/",
    createCharacterRoutes({
      characterController: container.resolve("characterController"),
    }),
  );

  router.route(
    "/",
    createEventRoutes({ eventController: container.resolve("eventController") }),
  );

  router.route(
    "/",
    createPlotRoutes({ plotController: container.resolve("plotController") }),
  );

  router.route(
    "/",
    createChapterRoutes({
      chapterController: container.resolve("chapterController"),
    }),
  );

  // Mounted after chapterRoutes: scene collection endpoints live UNDER
  // `/:projectId/chapters/:chapterId/scenes`, so they share a prefix with the
  // chapter item endpoints. They differ by depth, not by ambiguity, but keeping
  // the more specific router last matches how the paths read.
  router.route(
    "/",
    createSceneRoutes({ sceneController: container.resolve("sceneController") }),
  );

  // Last, and it must stay last only in the sense that it reads that way: its
  // nested paths sit one segment DEEPER than every entity router above
  // (`/:projectId/characters/:characterId/relationships` vs
  // `/:projectId/characters/:characterId`), so Hono distinguishes them by shape,
  // not by registration order. Nothing here shadows anything above it.
  router.route(
    "/",
    createRelationshipRoutes({
      relationshipController: container.resolve("relationshipController"),
    }),
  );

  // Phase 7.8, mounted beside the relationship router for the same reason it can
  // be: its own nested lists are one segment deeper than the entity routers
  // (`/:projectId/scenes/:sceneId/narrative-transitions`), and its two flat
  // collections (`/narrative-transitions`, `/assertions`) are segments
  // no other content router claims. Order is irrelevant here; shape decides.
  router.route(
    "/",
    createNarrativeTransitionRoutes({
      narrativeTransitionController: container.resolve(
        "narrativeTransitionController",
      ),
    }),
  );
}
