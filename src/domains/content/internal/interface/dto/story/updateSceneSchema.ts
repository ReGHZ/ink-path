import { z } from "zod";

import {
  sceneContentSchema,
  sceneOrderInChapterSchema,
  sceneSummarySchema,
  sceneTitleSchema,
} from "./sceneFieldSchemas.js";

// No `chapterId`, deliberately — the same exclusion already made in UpdateSceneInput and
// SceneMapper.toUpdatePersistence. The domain exposes no re-parent operation, so offering
// the field here could only either write back the value it already has, or open a
// re-parent path the domain never sanctioned.
export const updateSceneSchema = z
  .object({
    title: sceneTitleSchema.nullish(),
    summary: sceneSummarySchema.nullish(),
    content: sceneContentSchema.nullish(),
    orderInChapter: sceneOrderInChapterSchema.optional(),
  })
  .strict();

export type UpdateSceneRequestDto = z.infer<typeof updateSceneSchema>;
