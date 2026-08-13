import { z } from "zod";

import {
  sceneContentSchema,
  sceneOrderInChapterSchema,
  sceneSummarySchema,
  sceneTitleSchema,
} from "./sceneFieldSchemas.js";

// No `projectId` AND no `chapterId` — both come from route params, because scenes are
// created through the nested collection POST /projects/:projectId/chapters/:chapterId/scenes.
// Accepting `chapterId` in the body as well would create two sources for the same fact and
// invite them to disagree.
//
// `orderInChapter` is required for the same reason `order` is required on chapters:
// NOT NULL with a composite unique index behind it, so there is no safe invented default.
export const createSceneSchema = z
  .object({
    orderInChapter: sceneOrderInChapterSchema,
    title: sceneTitleSchema.nullish(),
    summary: sceneSummarySchema.nullish(),
    content: sceneContentSchema.nullish(),
  })
  .strict();

export type CreateSceneRequestDto = z.infer<typeof createSceneSchema>;

export const createSceneResponseSchema = z
  .object({
    sceneId: z.string(),
  })
  .strict();

export type CreateSceneResponseDto = z.infer<typeof createSceneResponseSchema>;
