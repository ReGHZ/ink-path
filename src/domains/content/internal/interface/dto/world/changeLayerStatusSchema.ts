import { z } from "zod";

import { layerStatusSchema } from "./layerFieldSchemas.js";

export const changeLayerStatusSchema = z
  .object({
    status: layerStatusSchema,
  })
  .strict();

export type ChangeLayerStatusRequestDto = z.infer<
  typeof changeLayerStatusSchema
>;
