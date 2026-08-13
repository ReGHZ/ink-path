import { z } from "zod";

import { eventStatusSchema } from "./eventFieldSchemas.js";

export const changeEventStatusSchema = z
  .object({
    status: eventStatusSchema,
  })
  .strict();

export type ChangeEventStatusRequestDto = z.infer<
  typeof changeEventStatusSchema
>;
