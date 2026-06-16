import { z } from "zod";

import { projectVisibilitySchema } from "./fieldSchemas.js";

export const projectResponseSchema = z
  .object({
    id: z.string(),
    ownerUserId: z.string(),
    createdByUserId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    genre: z.string().nullable(),
    tone: z.string().nullable(),
    style: z.string().nullable(),
    language: z.string().nullable(),
    visibility: projectVisibilitySchema,
    status: z.enum(["draft", "active", "archived"]),
    createdAt: z.date(),
    updatedAt: z.date(),
    archivedAt: z.date().nullable(),
  })
  .strict();

export type ProjectResponseDto = z.infer<typeof projectResponseSchema>;
