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

// No `projectId` — scoping comes from the route param, same as createLayerSchema.
// No `status` either — Character.create() always starts at "draft". No `parentId`
// either — Character has no self-hierarchy (see the "Character has no parentId/
// self-hierarchy" comment in CharacterRepositoryError.ts).
export const createCharacterSchema = z
  .object({
    name: characterNameSchema,
    archetype: characterArchetypeSchema.nullish(),
    background: characterBackgroundSchema.nullish(),
    personality: characterPersonalitySchema.nullish(),
    goal: characterGoalSchema.nullish(),
    description: characterDescriptionSchema.nullish(),
    content: characterContentSchema.nullish(),
  })
  .strict();

export type CreateCharacterRequestDto = z.infer<typeof createCharacterSchema>;

export const createCharacterResponseSchema = z
  .object({
    characterId: z.string(),
  })
  .strict();

export type CreateCharacterResponseDto = z.infer<
  typeof createCharacterResponseSchema
>;
