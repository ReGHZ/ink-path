import { z } from "zod";

import { sceneStatusSchema } from "./sceneFieldSchemas.js";

export const changeSceneStatusSchema = z
  .object({
    status: sceneStatusSchema,
  })
  .strict();

export type ChangeSceneStatusRequestDto = z.infer<
  typeof changeSceneStatusSchema
>;
