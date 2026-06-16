import { z } from "zod";

export const projectNameSchema = z.string().trim().min(1).max(255);

export const projectDescriptionSchema = z.string().trim().min(1).max(2000);
export const projectGenreSchema = z.string().trim().min(1).max(100);
export const projectToneSchema = z.string().trim().min(1).max(100);
export const projectStyleSchema = z.string().trim().min(1).max(100);
export const projectLanguageSchema = z.string().trim().min(1).max(100);

export const projectVisibilitySchema = z.enum(["private", "shared", "public"]);

export const projectRoleSchema = z.enum(["writer", "editor", "reviewer"]);
