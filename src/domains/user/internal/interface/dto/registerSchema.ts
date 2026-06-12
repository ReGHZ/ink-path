import { z } from "zod";

import { displayNameSchema, emailSchema } from "./fieldSchemas.js";

const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\dA-Za-z]).+$/, {
    message: "Password must contain uppercase, lowercase, number, and symbol",
  });

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1).max(128),
    username: z.string().trim().min(3).max(32).nullable().optional(),
    displayName: displayNameSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterRequestDto = z.infer<typeof registerSchema>;
