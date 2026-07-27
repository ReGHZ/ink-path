import { z } from "zod";

import { factionStatusSchema } from "./factionFieldSchemas.js";

export const changeFactionStatusSchema = z
  .object({
    status: factionStatusSchema,
  })
  .strict();

export type ChangeFactionStatusRequestDto = z.infer<
  typeof changeFactionStatusSchema
>;
