import { z } from "zod";

import {
  chapterContentSchema,
  chapterOrderSchema,
  chapterSummarySchema,
  chapterTitleSchema,
} from "./chapterFieldSchemas.js";

// Every field optional — partial update, matching UpdateChapterInput's own shape exactly.
// `title` and `order` are `.optional()` (non-nullable in the entity), `summary`/`content`
// are `.nullish()` so an explicit null can clear them.
//
// No `status` here: Flow 5 transitions are a separate endpoint because the target status
// alone cannot identify the transition (two edges land on `draft`), and because the
// entity refuses ordinary edits outside `draft` anyway.
export const updateChapterSchema = z
  .object({
    title: chapterTitleSchema.optional(),
    order: chapterOrderSchema.optional(),
    summary: chapterSummarySchema.nullish(),
    content: chapterContentSchema.nullish(),
  })
  .strict();

export type UpdateChapterRequestDto = z.infer<typeof updateChapterSchema>;
