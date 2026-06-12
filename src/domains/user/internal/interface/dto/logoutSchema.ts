import { z } from "zod";

import { refreshTokenSchema } from "./fieldSchemas.js";

export const logoutSchema = z.object({
  refreshToken: refreshTokenSchema,
}).strict();

export type LogoutRequestDto = z.infer<typeof logoutSchema>;
