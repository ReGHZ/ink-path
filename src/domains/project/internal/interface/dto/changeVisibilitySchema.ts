import { z } from "zod";

import { projectVisibilitySchema } from "./fieldSchemas.js";

export const changeVisibilitySchema = z
  .object({
    visibility: projectVisibilitySchema,
  })
  .strict();

export type ChangeVisibilityRequestDto = z.infer<typeof changeVisibilitySchema>;
