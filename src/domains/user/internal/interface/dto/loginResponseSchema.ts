import { z } from "zod";

const authenticatedUserSchema = z
  .object({
    id: z.string(),
    email: z.email(),
    username: z.string().nullable(),
    displayName: z.string().nullable(),
  })
  .strict();

export const loginResponseSchema = z
  .object({
    user: authenticatedUserSchema,
    accessToken: z.string(),
    refreshToken: z.string(),
  })
  .strict();

export type LoginResponseDto = z.infer<typeof loginResponseSchema>;
