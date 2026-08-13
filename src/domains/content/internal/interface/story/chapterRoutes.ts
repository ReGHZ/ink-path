import { Hono } from "hono";

import type { ChapterController } from "./ChapterController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createChapterRoutes({
  chapterController,
}: {
  chapterController: ChapterController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/chapters", (c) => chapterController.createChapter(c));
  routes.get("/:projectId/chapters", (c) => chapterController.listChapters(c));
  routes.get("/:projectId/chapters/:chapterId", (c) =>
    chapterController.getChapter(c),
  );
  routes.patch("/:projectId/chapters/:chapterId", (c) =>
    chapterController.updateChapter(c),
  );
  // One endpoint for all five Flow 5 transitions — see ChapterController.changeChapterStatus.
  routes.patch("/:projectId/chapters/:chapterId/status", (c) =>
    chapterController.changeChapterStatus(c),
  );
  routes.delete("/:projectId/chapters/:chapterId", (c) =>
    chapterController.deleteChapter(c),
  );

  return routes;
}
