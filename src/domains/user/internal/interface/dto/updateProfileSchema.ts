import { z } from "zod";

import { displayNameSchema } from "./fieldSchemas.js";

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.nullable().optional(),
    avatarUrl: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.displayName !== undefined || value.avatarUrl !== undefined,
    { message: "At least one profile field is required" },
  );

export type UpdateProfileRequestDto = z.infer<typeof updateProfileSchema>;
