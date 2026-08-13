import { z } from "zod";

import {
  plotConflictSchema,
  plotContentSchema,
  plotDescriptionSchema,
  plotNameSchema,
  plotResolutionSchema,
  plotThemeSchema,
} from "./plotFieldSchemas.js";

// No `projectId` — scoping comes from the route param. No `status` either — Plot.create()
// always starts at "draft".
export const createPlotSchema = z
  .object({
    name: plotNameSchema,
    description: plotDescriptionSchema.nullish(),
    theme: plotThemeSchema.nullish(),
    conflict: plotConflictSchema.nullish(),
    resolution: plotResolutionSchema.nullish(),
    content: plotContentSchema.nullish(),
  })
  .strict();

export type CreatePlotRequestDto = z.infer<typeof createPlotSchema>;

export const createPlotResponseSchema = z
  .object({
    plotId: z.string(),
  })
  .strict();

export type CreatePlotResponseDto = z.infer<typeof createPlotResponseSchema>;
