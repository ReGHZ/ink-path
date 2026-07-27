import { z } from "zod";

import { characterStatusSchema } from "./characterFieldSchemas.js";

export const characterResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    name: z.string(),
    archetype: z.string().nullable(),
    background: z.string().nullable(),
    personality: z.string().nullable(),
    goal: z.string().nullable(),
    description: z.string().nullable(),
    content: z.string().nullable(),
    status: characterStatusSchema,
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type CharacterResponseDto = z.infer<typeof characterResponseSchema>;

export const characterListResponseSchema = z
  .object({
    characters: z.array(characterResponseSchema),
  })
  .strict();

export type CharacterListResponseDto = z.infer<
  typeof characterListResponseSchema
>;
