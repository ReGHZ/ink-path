import { z } from "zod";

import { chapterStatusSchema } from "./chapterFieldSchemas.js";

export const chapterResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdByUserId: z.string(),
    title: z.string(),
    order: z.number().int(),
    summary: z.string().nullable(),
    content: z.string().nullable(),
    status: chapterStatusSchema,
    // Nullable and moves with `status` — set on publish, reset on unpublish (Flow 5
    // side effect, enforced by Chapter.validate()).
    publishedAt: z.date().nullable(),
    currentRevisionId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type ChapterResponseDto = z.infer<typeof chapterResponseSchema>;

export const chapterListResponseSchema = z
  .object({
    chapters: z.array(chapterResponseSchema),
  })
  .strict();

export type ChapterListResponseDto = z.infer<typeof chapterListResponseSchema>;
