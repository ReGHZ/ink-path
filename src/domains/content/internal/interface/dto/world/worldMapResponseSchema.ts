import { z } from "zod";

import { worldMapStatusSchema } from "./worldMapFieldSchemas.js";

export const worldMapResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    scale: z.string().nullable(),
    terrain: z.string().nullable(),
    environment: z.string().nullable(),
    description: z.string().nullable(),
    content: z.string().nullable(),
    status: worldMapStatusSchema,
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type WorldMapResponseDto = z.infer<typeof worldMapResponseSchema>;

export const worldMapListResponseSchema = z
  .object({
    worldMaps: z.array(worldMapResponseSchema),
  })
  .strict();

export type WorldMapListResponseDto = z.infer<
  typeof worldMapListResponseSchema
>;
