import { z } from "zod";

export const emailSchema = z.string().trim().pipe(z.email().max(254));

export const refreshTokenSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => /\S/.test(value), {
    message: "Refresh token must not contain only whitespace",
  });

export const displayNameSchema = z.string().trim().min(1).max(100);
