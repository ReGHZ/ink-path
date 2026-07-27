import { z } from "zod";

import { factionStatusSchema } from "./factionFieldSchemas.js";

export const factionResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    background: z.string().nullable(),
    ideology: z.string().nullable(),
    size: z.string().nullable(),
    content: z.string().nullable(),
    status: factionStatusSchema,
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type FactionResponseDto = z.infer<typeof factionResponseSchema>;

export const factionListResponseSchema = z
  .object({
    factions: z.array(factionResponseSchema),
  })
  .strict();

export type FactionListResponseDto = z.infer<
  typeof factionListResponseSchema
>;
