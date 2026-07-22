import { z } from "zod";

import { worldElementStatusSchema } from "./worldElementFieldSchemas.js";

export const changeWorldElementStatusSchema = z
  .object({
    status: worldElementStatusSchema,
  })
  .strict();

export type ChangeWorldElementStatusRequestDto = z.infer<
  typeof changeWorldElementStatusSchema
>;
