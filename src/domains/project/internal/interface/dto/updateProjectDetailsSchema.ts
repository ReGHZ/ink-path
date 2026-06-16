import { z } from "zod";

import {
  projectDescriptionSchema,
  projectGenreSchema,
  projectLanguageSchema,
  projectNameSchema,
  projectStyleSchema,
  projectToneSchema,
} from "./fieldSchemas.js";

export const updateProjectDetailsSchema = z
  .object({
    name: projectNameSchema,
    description: projectDescriptionSchema.nullish(),
    genre: projectGenreSchema.nullish(),
    tone: projectToneSchema.nullish(),
    style: projectStyleSchema.nullish(),
    language: projectLanguageSchema.nullish(),
  })
  .strict();

export type UpdateProjectDetailsRequestDto = z.infer<typeof updateProjectDetailsSchema>;
