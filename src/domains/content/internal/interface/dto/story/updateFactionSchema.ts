import { z } from "zod";

import {
  factionBackgroundSchema,
  factionContentSchema,
  factionDescriptionSchema,
  factionIdeologySchema,
  factionNameSchema,
  factionSizeSchema,
} from "./factionFieldSchemas.js";

// Every field optional — partial update, matching UpdateFactionInput's own shape
// exactly (all fields optional there too).
export const updateFactionSchema = z
  .object({
    name: factionNameSchema.optional(),
    description: factionDescriptionSchema.nullish(),
    background: factionBackgroundSchema.nullish(),
    ideology: factionIdeologySchema.nullish(),
    size: factionSizeSchema.nullish(),
    content: factionContentSchema.nullish(),
  })
  .strict();

export type UpdateFactionRequestDto = z.infer<typeof updateFactionSchema>;
