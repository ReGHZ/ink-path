import { z } from "zod";

import { chapterStatusSchema } from "./chapterFieldSchemas.js";

// Only the TARGET status travels in the body. The origin is not a client input: it is read
// from the stored chapter inside ChapterService, which then resolves the (origin, target)
// pair against CHAPTER_TRANSITIONS. Accepting an origin here would let a client assert a
// state it is not allowed to assert, and would race with any concurrent transition.
export const changeChapterStatusSchema = z
  .object({
    status: chapterStatusSchema,
  })
  .strict();

export type ChangeChapterStatusRequestDto = z.infer<
  typeof changeChapterStatusSchema
>;
