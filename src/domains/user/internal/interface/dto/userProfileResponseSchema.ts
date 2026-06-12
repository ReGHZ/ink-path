import { z } from "zod";

export const userProfileResponseSchema = z
  .object({
    id: z.string(),
    email: z.email(),
    username: z.string().nullable(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  })
  .strict();

export type UserProfileResponseDto = z.infer<
  typeof userProfileResponseSchema
>;
