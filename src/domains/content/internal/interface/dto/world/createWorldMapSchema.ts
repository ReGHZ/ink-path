import { z } from "zod";

import {
  worldMapContentSchema,
  worldMapDescriptionSchema,
  worldMapEnvironmentSchema,
  worldMapNameSchema,
  worldMapScaleSchema,
  worldMapTerrainSchema,
} from "./worldMapFieldSchemas.js";

// No `projectId` — scoping comes from the route param, same as createLayerSchema/
// createWorldElementSchema. No `status` either — WorldMap.create() always starts
// at "draft". `parentId` IS included: it's genuine client-supplied input for
// hierarchy (CreateWorldMapInput.parentId in WorldMapService.ts), not derived
// from the route.
export const createWorldMapSchema = z
  .object({
    parentId: z.string().nullish(),
    name: worldMapNameSchema,
    scale: worldMapScaleSchema.nullish(),
    terrain: worldMapTerrainSchema.nullish(),
    environment: worldMapEnvironmentSchema.nullish(),
    description: worldMapDescriptionSchema.nullish(),
    content: worldMapContentSchema.nullish(),
  })
  .strict();

export type CreateWorldMapRequestDto = z.infer<typeof createWorldMapSchema>;

export const createWorldMapResponseSchema = z
  .object({
    worldMapId: z.string(),
  })
  .strict();

export type CreateWorldMapResponseDto = z.infer<
  typeof createWorldMapResponseSchema
>;
