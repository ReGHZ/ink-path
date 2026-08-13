import { z } from "zod";

export const eventTitleSchema = z.string().trim().min(1).max(255);

// Free-form classifiers, not closed enums — 03-database-design/06_content_tables.md:180-183
// describes `era`/`event_type`/`significance` with examples only ("misalnya `historical`,
// `personal`, ..."), and Event.validate() never rejects an unrecognized value. Same call
// already made for characterArchetypeSchema.
export const eventEraSchema = z.string().trim().min(1).max(100);

export const eventTypeSchema = z.string().trim().min(1).max(100);

export const eventSignificanceSchema = z.string().trim().min(1).max(100);

// Deliberately NOT `.nonnegative()`, unlike chapterOrderSchema: Event.validate() only
// requires an integer, and 06_content_tables.md:181 explicitly allows duplicates for
// parallel events. A negative value is a legitimate "before the era anchor" position.
export const eventTimelineOrderSchema = z.number().int();

export const eventDescriptionSchema = z.string().trim().min(1).max(2000);

// Provisional ceiling, same reasoning as worldElementContentSchema — DB column is plain
// `text` (no frozen length requirement); adjust if a real requirement surfaces.
export const eventContentSchema = z.string().trim().min(1).max(20000);

export const eventStatusSchema = z.enum(["draft", "published"]);
