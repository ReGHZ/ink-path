import { z } from "zod";

import {
  worldElementCategorySchema,
  worldElementContentSchema,
  worldElementDescriptionSchema,
  worldElementNameSchema,
} from "./worldElementFieldSchemas.js";

// Every field optional — this is a partial update (Flow 3 Update step 1: "field yang
// di-update", partial), matching UpdateWorldElementInput's own shape exactly (all
// fields optional there too, unlike Project's updateProjectDetailsSchema which keeps
// `name` mandatory for its own domain reasons). Presence vs absence still matters
// downstream: WorldElement.updateDetails() treats an omitted field as "leave
// untouched" and an explicit `null` (on description/content) as "clear it" — this
// schema only validates shape, that distinction is the domain entity's job.
export const updateWorldElementSchema = z
  .object({
    name: worldElementNameSchema.optional(),
    description: worldElementDescriptionSchema.nullish(),
    category: worldElementCategorySchema.optional(),
    content: worldElementContentSchema.nullish(),
  })
  .strict();

export type UpdateWorldElementRequestDto = z.infer<typeof updateWorldElementSchema>;
