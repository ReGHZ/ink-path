import { z } from "zod";

import { layerExposureSchema, layerStatusSchema } from "./layerFieldSchemas.js";

export const layerResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    level: z.number(),
    exposure: layerExposureSchema,
    description: z.string().nullable(),
    content: z.string().nullable(),
    status: layerStatusSchema,
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type LayerResponseDto = z.infer<typeof layerResponseSchema>;

export const layerListResponseSchema = z
  .object({
    layers: z.array(layerResponseSchema),
  })
  .strict();

export type LayerListResponseDto = z.infer<typeof layerListResponseSchema>;
