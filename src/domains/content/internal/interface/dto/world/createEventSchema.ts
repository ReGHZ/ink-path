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

// No `projectId` — scoping comes from the route param, same as createCharacterSchema.
// No `status` either — Event.create() always starts at "draft".
export const createEventSchema = z
  .object({
    title: eventTitleSchema,
    era: eventEraSchema.nullish(),
    timelineOrder: eventTimelineOrderSchema.nullish(),
    eventType: eventTypeSchema.nullish(),
    significance: eventSignificanceSchema.nullish(),
    description: eventDescriptionSchema.nullish(),
    content: eventContentSchema.nullish(),
  })
  .strict();

export type CreateEventRequestDto = z.infer<typeof createEventSchema>;

export const createEventResponseSchema = z
  .object({
    eventId: z.string(),
  })
  .strict();

export type CreateEventResponseDto = z.infer<typeof createEventResponseSchema>;
