import { z } from "zod";

import { plotStatusSchema } from "./plotFieldSchemas.js";

export const changePlotStatusSchema = z
  .object({
    status: plotStatusSchema,
  })
  .strict();

export type ChangePlotStatusRequestDto = z.infer<typeof changePlotStatusSchema>;
