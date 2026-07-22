import { z } from "zod";

import {
  worldElementCategorySchema,
  worldElementContentSchema,
  worldElementDescriptionSchema,
  worldElementNameSchema,
} from "./worldElementFieldSchemas.js";

// No `projectId` field — scoping comes from the route param (`requireProjectId(c)`),
// same as every project-scoped body in the Project domain (see changeMemberRoleSchema.ts,
// which likewise omits `projectId`/`userId`). No `status` either — WorldElement.create()
// always starts at "draft"; status only ever changes via changeWorldElementStatusSchema.
export const createWorldElementSchema = z
  .object({
    name: worldElementNameSchema,
    description: worldElementDescriptionSchema.nullish(),
    category: worldElementCategorySchema,
    content: worldElementContentSchema.nullish(),
  })
  .strict();

export type CreateWorldElementRequestDto = z.infer<typeof createWorldElementSchema>;

export const createWorldElementResponseSchema = z
  .object({
    worldElementId: z.string(),
  })
  .strict();

export type CreateWorldElementResponseDto = z.infer<
  typeof createWorldElementResponseSchema
>;
