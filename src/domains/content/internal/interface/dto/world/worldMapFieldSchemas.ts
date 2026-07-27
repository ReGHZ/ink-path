import { z } from "zod";

export const worldMapNameSchema = z.string().trim().min(1).max(255);

// Free-form classifiers, not closed enums — 03-database-design/06_content_tables.md:115-117
// lists recommended vocabulary for `scale` (world, realm, continent, ...) but says
// explicitly "Bukan enum DB ketat" (not a strict DB enum); `terrain`/`environment` have
// no vocabulary at all in the frozen docs. WorldMap.validate() never rejects an
// unrecognized value for any of the three, so a z.enum() here would reject legitimate
// input the domain accepts.
export const worldMapScaleSchema = z.string().trim().min(1).max(100);

export const worldMapTerrainSchema = z.string().trim().min(1).max(100);

export const worldMapEnvironmentSchema = z.string().trim().min(1).max(100);

export const worldMapDescriptionSchema = z.string().trim().min(1).max(2000);

// Provisional ceiling, same reasoning as worldElementContentSchema — DB column is
// plain `text` (no frozen length requirement); adjust if a real requirement surfaces.
export const worldMapContentSchema = z.string().trim().min(1).max(20000);

export const worldMapStatusSchema = z.enum(["draft", "published"]);
