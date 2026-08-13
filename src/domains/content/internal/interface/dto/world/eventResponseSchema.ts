import { z } from "zod";

import { eventStatusSchema } from "./eventFieldSchemas.js";

export const eventResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    title: z.string(),
    era: z.string().nullable(),
    timelineOrder: z.number().int().nullable(),
    eventType: z.string().nullable(),
    significance: z.string().nullable(),
    description: z.string().nullable(),
    content: z.string().nullable(),
    status: eventStatusSchema,
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type EventResponseDto = z.infer<typeof eventResponseSchema>;

export const eventListResponseSchema = z
  .object({
    events: z.array(eventResponseSchema),
  })
  .strict();

export type EventListResponseDto = z.infer<typeof eventListResponseSchema>;
