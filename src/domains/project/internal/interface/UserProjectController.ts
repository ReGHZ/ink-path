import { changeMemberRoleSchema } from "./dto/changeMemberRoleSchema.js";
import { memberListResponseSchema } from "./dto/memberResponseSchema.js";
import { UserProjectDtoMapper } from "./mappers/UserProjectDtoMapper.js";
import { requireProjectId, requireTargetUserId, type AppEnvironment } from "../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../shared/http/requestValidation.js";
import { success } from "../../../../shared/http/response.js";

import type { UserProjectService } from "../application/UserProjectService.js";
import type { Context } from "hono";

export class UserProjectController {
    constructor(private readonly userProjectService: UserProjectService) { }

    async listMembers(c: Context<AppEnvironment>) {
        const projectId = requireProjectId(c)

        const detail = await this.userProjectService.listMembers(projectId)
        const response = UserProjectDtoMapper.toMemberListResponse(detail)
        const validatedResponse = memberListResponseSchema.parse(response)

        return success(c, validatedResponse)
    }

    async changeMemberRole(c: Context<AppEnvironment>) {
        const dto = await parseJsonBody(c, changeMemberRoleSchema)
        const projectId = requireProjectId(c)
        const userId = requireTargetUserId(c)

        await this.userProjectService.changeMemberRole(projectId, userId, dto.role)

        return success(c, null, 200)
    }
}


export function createUserProjectController({
    userProjectService,
}: {
    userProjectService: UserProjectService;
}): UserProjectController {
    return new UserProjectController(userProjectService);
}