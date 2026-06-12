import { z } from "zod";

import { emailSchema } from "./fieldSchemas.js";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict();

export type LoginRequestDto = z.infer<typeof loginSchema>;
