import { z } from "zod";

export const worldElementNameSchema = z.string().trim().min(1).max(255);

export const worldElementDescriptionSchema = z.string().trim().min(1).max(2000);

// Free-form classifier, not a closed enum — 03-database-design/06_content_tables.md:168
// lists a recommended vocabulary ("item, technique, creature, system, artifact") but
// explicitly allows "kategori lain yang diizinkan" (other allowed category), and
// WorldElement.validate() only rejects blank/whitespace, never an unrecognized value.
// A z.enum() here would reject legitimate custom categories the domain accepts.
export const worldElementCategorySchema = z.string().trim().min(1).max(100);

// No length bound is specified anywhere in the frozen docs for this field (DB column
// is plain `text`) — 20000 is a provisional ceiling picked to allow long-form world
// architecture detail while still rejecting pathological payloads; adjust if a real
// requirement surfaces.
export const worldElementContentSchema = z.string().trim().min(1).max(20000);

export const worldElementStatusSchema = z.enum(["draft", "published"]);
