import { z } from "zod";

import { plotStatusSchema } from "./plotFieldSchemas.js";

export const plotResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    theme: z.string().nullable(),
    conflict: z.string().nullable(),
    resolution: z.string().nullable(),
    content: z.string().nullable(),
    status: plotStatusSchema,
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type PlotResponseDto = z.infer<typeof plotResponseSchema>;

export const plotListResponseSchema = z
  .object({
    plots: z.array(plotResponseSchema),
  })
  .strict();

export type PlotListResponseDto = z.infer<typeof plotListResponseSchema>;
