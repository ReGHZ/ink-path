import { Hono } from "hono";

import type { SceneController } from "./SceneController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

// Deliberately hybrid, and the split is not cosmetic:
//
//   COLLECTION endpoints are nested under the chapter
//     POST /:projectId/chapters/:chapterId/scenes
//     GET  /:projectId/chapters/:chapterId/scenes
//   because both genuinely need the chapter — create must attach the scene to it, list
//   must scope by it — and SceneService verifies same-project ownership of that chapter
//   on both paths.
//
//   ITEM endpoints are flat under the project
//     GET|PATCH|DELETE /:projectId/scenes/:sceneId
//     PATCH            /:projectId/scenes/:sceneId/status
//   because SceneService's item methods take (projectId, sceneId) only. Nesting them
//   would put a `:chapterId` in the URL that NOTHING verifies against the scene actually
//   loaded, so `/chapters/A/scenes/<scene-of-chapter-B>` would answer 200 with B's scene
//   — a path segment that looks authoritative while being decorative. Better to not
//   promise it than to promise it and not check it.
export function createSceneRoutes({
  sceneController,
}: {
  sceneController: SceneController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/chapters/:chapterId/scenes", (c) =>
    sceneController.createScene(c),
  );
  routes.get("/:projectId/chapters/:chapterId/scenes", (c) =>
    sceneController.listScenesByChapter(c),
  );

  routes.get("/:projectId/scenes/:sceneId", (c) => sceneController.getScene(c));
  routes.patch("/:projectId/scenes/:sceneId", (c) =>
    sceneController.updateScene(c),
  );
  routes.patch("/:projectId/scenes/:sceneId/status", (c) =>
    sceneController.changeSceneStatus(c),
  );
  routes.delete("/:projectId/scenes/:sceneId", (c) =>
    sceneController.deleteScene(c),
  );

  return routes;
}
