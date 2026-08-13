import { z } from "zod";

import {
  chapterContentSchema,
  chapterOrderSchema,
  chapterSummarySchema,
  chapterTitleSchema,
} from "./chapterFieldSchemas.js";

// No `projectId` — scoping comes from the route param. No `status` either — Chapter.create()
// always starts at "outline", the entry state of Flow 5's machine; moving away from it is
// the job of PATCH /chapters/:chapterId/status, never of create.
//
// `order` IS required, unlike every other create schema so far: `chapters.order` is
// NOT NULL with a composite unique index on (project_id, order), so there is no server-side
// default that could be safely invented here.
export const createChapterSchema = z
  .object({
    title: chapterTitleSchema,
    order: chapterOrderSchema,
    summary: chapterSummarySchema.nullish(),
    content: chapterContentSchema.nullish(),
  })
  .strict();

export type CreateChapterRequestDto = z.infer<typeof createChapterSchema>;

export const createChapterResponseSchema = z
  .object({
    chapterId: z.string(),
  })
  .strict();

export type CreateChapterResponseDto = z.infer<
  typeof createChapterResponseSchema
>;
