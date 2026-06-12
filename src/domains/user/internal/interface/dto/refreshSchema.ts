import { z } from "zod";

import { refreshTokenSchema } from "./fieldSchemas.js";

export const refreshSchema = z.object({
  refreshToken: refreshTokenSchema,
}).strict();

export type RefreshRequestDto = z.infer<typeof refreshSchema>;
