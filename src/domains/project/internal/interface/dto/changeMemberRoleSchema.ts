import { z } from "zod";

import { projectRoleSchema } from "./fieldSchemas.js";

export const changeMemberRoleSchema = z
  .object({
    role: projectRoleSchema,
  })
  .strict();

export type ChangeMemberRoleRequestDto = z.infer<typeof changeMemberRoleSchema>;
