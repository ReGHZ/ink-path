import { z } from "zod";

import {
  layerContentSchema,
  layerDescriptionSchema,
  layerExposureSchema,
  layerLevelSchema,
  layerNameSchema,
} from "./layerFieldSchemas.js";

export const createLayerSchema = z
  .object({
    parentId: z.string().nullish(),
    name: layerNameSchema,
    level: layerLevelSchema,
    exposure: layerExposureSchema,
    description: layerDescriptionSchema.nullish(),
    content: layerContentSchema.nullish(),
  })
  .strict();

export type CreateLayerRequestDto = z.infer<typeof createLayerSchema>;

export const createLayerResponseSchema = z
  .object({
    layerId: z.string(),
  })
  .strict();

export type CreateLayerResponseDto = z.infer<typeof createLayerResponseSchema>;
