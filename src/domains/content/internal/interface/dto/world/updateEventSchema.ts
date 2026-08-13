import { z } from "zod";

import {
  eventContentSchema,
  eventDescriptionSchema,
  eventEraSchema,
  eventSignificanceSchema,
  eventTimelineOrderSchema,
  eventTitleSchema,
  eventTypeSchema,
} from "./eventFieldSchemas.js";

// Every field optional — partial update, matching UpdateEventInput's own shape exactly.
// `title` is `.optional()` rather than `.nullish()` because it is non-nullable in the
// entity; the nullable fields keep `.nullish()` so an explicit null can clear them.
export const updateEventSchema = z
  .object({
    title: eventTitleSchema.optional(),
    era: eventEraSchema.nullish(),
    timelineOrder: eventTimelineOrderSchema.nullish(),
    eventType: eventTypeSchema.nullish(),
    significance: eventSignificanceSchema.nullish(),
    description: eventDescriptionSchema.nullish(),
    content: eventContentSchema.nullish(),
  })
  .strict();

export type UpdateEventRequestDto = z.infer<typeof updateEventSchema>;
