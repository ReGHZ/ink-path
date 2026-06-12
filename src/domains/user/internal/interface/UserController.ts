import { updateProfileSchema } from "./dto/updateProfileSchema.js";
import { userProfileResponseSchema } from "./dto/userProfileResponseSchema.js";
import { UserDtoMapper } from "./mappers/UserDtoMapper.js";
import {
    requireUserId,
    type AppEnvironment,
} from "../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../shared/http/requestValidation.js";
import { success } from "../../../../shared/http/response.js";

import type { UserService } from "../application/UserService.js";
import type { Context } from "hono";

export class UserController {
    constructor(private readonly userService: UserService) { }

    async getMyProfile(c: Context<AppEnvironment>) {
        const userId = requireUserId(c);

        const profile = await this.userService.getMyProfile(userId);
        const response = UserDtoMapper.toProfileResponse(profile);
        const validatedResponse = userProfileResponseSchema.parse(response);

        return success(c, validatedResponse);
    }

    async updateMyProfile(c: Context<AppEnvironment>) {
        const userId = requireUserId(c);
        const dto = await parseJsonBody(c, updateProfileSchema);
        const input = UserDtoMapper.toUpdateProfileInput(dto);

        const profile = await this.userService.updateMyProfile(userId, input);
        const response = UserDtoMapper.toProfileResponse(profile);
        const validatedResponse = userProfileResponseSchema.parse(response);

        return success(c, validatedResponse);
    }
}

export function createUserController({
    userService,
}: {
    userService: UserService;
}): UserController {
    return new UserController(userService);
}
