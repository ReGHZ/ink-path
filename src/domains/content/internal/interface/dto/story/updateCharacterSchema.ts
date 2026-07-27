import { z } from "zod";

import {
  characterArchetypeSchema,
  characterBackgroundSchema,
  characterContentSchema,
  characterDescriptionSchema,
  characterGoalSchema,
  characterNameSchema,
  characterPersonalitySchema,
} from "./characterFieldSchemas.js";

// Every field optional — partial update, matching UpdateCharacterInput's own shape
// exactly (all fields optional there too).
export const updateCharacterSchema = z
  .object({
    name: characterNameSchema.optional(),
    archetype: characterArchetypeSchema.nullish(),
    background: characterBackgroundSchema.nullish(),
    personality: characterPersonalitySchema.nullish(),
    goal: characterGoalSchema.nullish(),
    description: characterDescriptionSchema.nullish(),
    content: characterContentSchema.nullish(),
  })
  .strict();

export type UpdateCharacterRequestDto = z.infer<typeof updateCharacterSchema>;
