import { z } from "zod";

import { worldElementStatusSchema } from "./worldElementFieldSchemas.js";

export const worldElementResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    category: z.string(),
    content: z.string().nullable(),
    status: worldElementStatusSchema,
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type WorldElementResponseDto = z.infer<typeof worldElementResponseSchema>;

export const worldElementListResponseSchema = z
  .object({
    worldElements: z.array(worldElementResponseSchema),
  })
  .strict();

export type WorldElementListResponseDto = z.infer<
  typeof worldElementListResponseSchema
>;
