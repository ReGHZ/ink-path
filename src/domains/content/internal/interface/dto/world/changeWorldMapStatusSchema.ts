import { z } from "zod";

import { worldMapStatusSchema } from "./worldMapFieldSchemas.js";

export const changeWorldMapStatusSchema = z
  .object({
    status: worldMapStatusSchema,
  })
  .strict();

export type ChangeWorldMapStatusRequestDto = z.infer<
  typeof changeWorldMapStatusSchema
>;
