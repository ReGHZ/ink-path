import { z } from "zod";

import { projectRoleSchema } from "./fieldSchemas.js";

export const memberResponseSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    role: projectRoleSchema,
    canDelete: z.boolean(),
    aiAccess: z.enum(["none", "limited", "full"]),
    joinedAt: z.date().nullable(),
    invitedByUserId: z.string().nullable(),
  })
  .strict();

export type MemberResponseDto = z.infer<typeof memberResponseSchema>;

export const memberListResponseSchema = z
  .object({
    members: z.array(memberResponseSchema),
  })
  .strict();

export type MemberListResponseDto = z.infer<typeof memberListResponseSchema>;
