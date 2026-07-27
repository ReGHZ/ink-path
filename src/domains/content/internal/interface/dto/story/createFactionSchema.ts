import { z } from "zod";

import {
  factionBackgroundSchema,
  factionContentSchema,
  factionDescriptionSchema,
  factionIdeologySchema,
  factionNameSchema,
  factionSizeSchema,
} from "./factionFieldSchemas.js";

// No `projectId` — scoping comes from the route param, same as createLayerSchema.
// No `status` either — Faction.create() always starts at "draft". No `parentId`
// either — unlike Layer/WorldMap, Faction has no self-hierarchy (see the "Faction
// has no parentId/self-hierarchy" comment in FactionRepositoryError.ts).
export const createFactionSchema = z
  .object({
    name: factionNameSchema,
    description: factionDescriptionSchema.nullish(),
    background: factionBackgroundSchema.nullish(),
    ideology: factionIdeologySchema.nullish(),
    size: factionSizeSchema.nullish(),
    content: factionContentSchema.nullish(),
  })
  .strict();

export type CreateFactionRequestDto = z.infer<typeof createFactionSchema>;

export const createFactionResponseSchema = z
  .object({
    factionId: z.string(),
  })
  .strict();

export type CreateFactionResponseDto = z.infer<
  typeof createFactionResponseSchema
>;
