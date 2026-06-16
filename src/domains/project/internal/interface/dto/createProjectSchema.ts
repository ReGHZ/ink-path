import { z } from "zod";

import {
  projectDescriptionSchema,
  projectGenreSchema,
  projectLanguageSchema,
  projectNameSchema,
  projectStyleSchema,
  projectToneSchema,
} from "./fieldSchemas.js";

export const createProjectSchema = z
  .object({
    name: projectNameSchema,
    description: projectDescriptionSchema.optional(),
    genre: projectGenreSchema.optional(),
    tone: projectToneSchema.optional(),
    style: projectStyleSchema.optional(),
    language: projectLanguageSchema.optional(),
  })
  .strict();

export type CreateProjectRequestDto = z.infer<typeof createProjectSchema>;

export const createProjectResponseSchema = z
  .object({
    projectId: z.string(),
  })
  .strict();

export type CreateProjectResponseDto = z.infer<typeof createProjectResponseSchema>;
