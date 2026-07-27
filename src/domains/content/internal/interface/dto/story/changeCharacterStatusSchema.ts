import { z } from "zod";

import { characterStatusSchema } from "./characterFieldSchemas.js";

export const changeCharacterStatusSchema = z
  .object({
    status: characterStatusSchema,
  })
  .strict();

export type ChangeCharacterStatusRequestDto = z.infer<
  typeof changeCharacterStatusSchema
>;
