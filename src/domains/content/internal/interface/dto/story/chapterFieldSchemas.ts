import { z } from "zod";

export const chapterTitleSchema = z.string().trim().min(1).max(255);

// `.nonnegative()`, matching Chapter.validate()'s "non-negative integer" rule exactly
// (Chapter.ts) rather than being stricter or looser than the entity. Note this is NOT
// the same call as eventTimelineOrderSchema, which allows negatives: `chapters.order`
// backs a composite unique index and is a real position in a book, not a relative hint.
export const chapterOrderSchema = z.number().int().nonnegative();

// Larger than the 2000 used for `description` fields elsewhere: a chapter summary is the
// author's outline/plan for the whole chapter (06_content_tables.md:216), not a one-line
// blurb. Provisional — DB column is plain `text`.
export const chapterSummarySchema = z.string().trim().min(1).max(5000);

// The first genuinely long-form column in the codebase: this holds chapter prose, so the
// 20000-25000 ceilings used for worldbuilding `content` would reject an ordinary novel
// chapter. Provisional — DB column is plain `text`, and the live-editing checkpoint path
// (C2, notes/collab-editing-layer-design.md) will write through here too.
export const chapterContentSchema = z.string().trim().min(1).max(100000);

export const chapterStatusSchema = z.enum([
  "outline",
  "draft",
  "review",
  "published",
]);
