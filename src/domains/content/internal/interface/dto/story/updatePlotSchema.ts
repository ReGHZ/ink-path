import { z } from "zod";

import {
  plotConflictSchema,
  plotContentSchema,
  plotDescriptionSchema,
  plotNameSchema,
  plotResolutionSchema,
  plotThemeSchema,
} from "./plotFieldSchemas.js";

// Every field optional — partial update, matching UpdatePlotInput's own shape exactly.
export const updatePlotSchema = z
  .object({
    name: plotNameSchema.optional(),
    description: plotDescriptionSchema.nullish(),
    theme: plotThemeSchema.nullish(),
    conflict: plotConflictSchema.nullish(),
    resolution: plotResolutionSchema.nullish(),
    content: plotContentSchema.nullish(),
  })
  .strict();

export type UpdatePlotRequestDto = z.infer<typeof updatePlotSchema>;
