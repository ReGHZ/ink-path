import { z } from "zod";

import {
  layerContentSchema,
  layerDescriptionSchema,
  layerExposureSchema,
  layerLevelSchema,
  layerNameSchema,
} from "./layerFieldSchemas.js";

// No `parentId` — mirrors UpdateLayerInput exactly (LayerService.ts): the domain
// entity has no re-parenting method (Layer.updateDetails() never touches
// parentId), so there is nothing for this schema to accept it into.
export const updateLayerSchema = z
  .object({
    name: layerNameSchema.optional(),
    level: layerLevelSchema.optional(),
    exposure: layerExposureSchema.optional(),
    description: layerDescriptionSchema.nullish(),
    content: layerContentSchema.nullish(),
  })
  .strict();

export type UpdateLayerRequestDto = z.infer<typeof updateLayerSchema>;
