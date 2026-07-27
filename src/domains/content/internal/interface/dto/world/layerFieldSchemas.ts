import z from "zod";

export const layerNameSchema = z.string().trim().min(1).max(255);

export const layerLevelSchema = z.number().int().positive();

export const layerExposureSchema = z.enum([
  "internal_only",
  "character_aware",
  "reader_visible",
]);

export const layerDescriptionSchema = z.string().trim().min(1).max(2000);

export const layerContentSchema = z.string().trim().min(1).max(25000);

export const layerStatusSchema = z.enum(["draft", "published", "archived"]);
