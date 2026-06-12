import { z } from "zod";

const registeredUserSchema = z
  .object({
    id: z.string(),
    email: z.email(),
    username: z.string().nullable(),
    displayName: z.string().nullable(),
  })
  .strict();

export const registerResponseSchema = z
  .object({
    user: registeredUserSchema,
  })
  .strict();

export type RegisterResponseDto = z.infer<typeof registerResponseSchema>;
