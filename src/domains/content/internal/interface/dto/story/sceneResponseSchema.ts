import { z } from "zod";

import { sceneStatusSchema } from "./sceneFieldSchemas.js";

export const sceneResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    chapterId: z.string(),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    content: z.string().nullable(),
    orderInChapter: z.number().int(),
    status: sceneStatusSchema,
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type SceneResponseDto = z.infer<typeof sceneResponseSchema>;

export const sceneListResponseSchema = z
  .object({
    scenes: z.array(sceneResponseSchema),
  })
  .strict();

export type SceneListResponseDto = z.infer<typeof sceneListResponseSchema>;
