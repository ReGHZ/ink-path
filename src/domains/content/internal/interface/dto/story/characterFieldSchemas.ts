import { z } from "zod";

export const characterNameSchema = z.string().trim().min(1).max(255);

// Free-form classifier, not a closed enum — 03-database-design/06_content_tables.md:132
// only describes `archetype` as "Archetype/peran naratif" with no vocabulary list, and
// Character.validate() never rejects an unrecognized value.
export const characterArchetypeSchema = z.string().trim().min(1).max(100);

export const characterBackgroundSchema = z.string().trim().min(1).max(2000);

export const characterPersonalitySchema = z.string().trim().min(1).max(2000);

export const characterGoalSchema = z.string().trim().min(1).max(2000);

export const characterDescriptionSchema = z.string().trim().min(1).max(2000);

// Provisional ceiling, same reasoning as worldElementContentSchema — DB column is
// plain `text` (no frozen length requirement); adjust if a real requirement surfaces.
export const characterContentSchema = z.string().trim().min(1).max(20000);

export const characterStatusSchema = z.enum(["draft", "active", "archived"]);
