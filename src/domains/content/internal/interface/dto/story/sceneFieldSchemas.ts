import { z } from "zod";

// Nullable at the entity level — 06_content_tables.md:232 notes scenes are "sering tanpa
// judul". The schema itself still rejects an empty/whitespace string: "no title" is
// expressed as null, never as "".
export const sceneTitleSchema = z.string().trim().min(1).max(255);

export const sceneSummarySchema = z.string().trim().min(1).max(5000);

// Same long-form ceiling as chapterContentSchema — this is scene prose.
export const sceneContentSchema = z.string().trim().min(1).max(100000);

// `.nonnegative()`, matching Scene.validate() exactly. Backs the composite unique index
// (chapter_id, order_in_chapter), so a collision surfaces as
// SceneRepositoryOrderConflictError -> 409, not as a validation error here.
export const sceneOrderInChapterSchema = z.number().int().nonnegative();

export const sceneStatusSchema = z.enum(["draft", "published"]);
