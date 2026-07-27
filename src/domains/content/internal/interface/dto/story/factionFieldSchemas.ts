import { z } from "zod";

export const factionNameSchema = z.string().trim().min(1).max(255);

export const factionDescriptionSchema = z.string().trim().min(1).max(2000);

export const factionBackgroundSchema = z.string().trim().min(1).max(2000);

export const factionIdeologySchema = z.string().trim().min(1).max(2000);

// Free-form classifier, not a closed enum — 03-database-design/06_content_tables.md:153
// lists a recommended vocabulary (small, medium, large, massive) but explicitly allows
// "label deskriptif lain" (other descriptive label), and Faction.validate() never
// rejects an unrecognized value.
export const factionSizeSchema = z.string().trim().min(1).max(100);

// Provisional ceiling, same reasoning as worldElementContentSchema — DB column is
// plain `text` (no frozen length requirement); adjust if a real requirement surfaces.
export const factionContentSchema = z.string().trim().min(1).max(20000);

export const factionStatusSchema = z.enum(["draft", "active", "archived"]);
