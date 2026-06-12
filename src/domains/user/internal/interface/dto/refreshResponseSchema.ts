import { z } from "zod";

export const refreshResponseSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
  })
  .strict();

export type RefreshResponseDto = z.infer<typeof refreshResponseSchema>;
