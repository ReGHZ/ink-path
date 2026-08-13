import { z } from "zod";

// `name`, not `title` — 03-database-design/06_content_tables.md:199 keeps the ERD's
// own vocabulary for plots, and PlotDetail mirrors it.
export const plotNameSchema = z.string().trim().min(1).max(255);

export const plotDescriptionSchema = z.string().trim().min(1).max(2000);

// `theme`/`conflict`/`resolution` are `@db.Text`, not short classifiers like
// Event's `era`/`event_type` — they hold a paragraph of narrative reasoning.
export const plotThemeSchema = z.string().trim().min(1).max(2000);

export const plotConflictSchema = z.string().trim().min(1).max(2000);

export const plotResolutionSchema = z.string().trim().min(1).max(2000);

// Provisional ceiling, same reasoning as worldElementContentSchema — DB column is plain
// `text` (no frozen length requirement); adjust if a real requirement surfaces.
export const plotContentSchema = z.string().trim().min(1).max(20000);

export const plotStatusSchema = z.enum(["draft", "active", "completed"]);
