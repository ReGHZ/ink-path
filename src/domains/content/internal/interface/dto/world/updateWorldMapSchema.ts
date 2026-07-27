import { z } from "zod";

import {
  worldMapContentSchema,
  worldMapDescriptionSchema,
  worldMapEnvironmentSchema,
  worldMapNameSchema,
  worldMapScaleSchema,
  worldMapTerrainSchema,
} from "./worldMapFieldSchemas.js";

// No `parentId` — WorldMap.updateDetails() never touches parentId (same gap as
// Layer: re-parenting has no domain method), so UpdateWorldMapInput doesn't
// expose it and this schema can't either.
export const updateWorldMapSchema = z
  .object({
    name: worldMapNameSchema.optional(),
    scale: worldMapScaleSchema.nullish(),
    terrain: worldMapTerrainSchema.nullish(),
    environment: worldMapEnvironmentSchema.nullish(),
    description: worldMapDescriptionSchema.nullish(),
    content: worldMapContentSchema.nullish(),
  })
  .strict();

export type UpdateWorldMapRequestDto = z.infer<typeof updateWorldMapSchema>;
