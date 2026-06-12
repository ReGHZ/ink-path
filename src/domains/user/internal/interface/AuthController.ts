import { getConnInfo } from "@hono/node-server/conninfo";

import { loginResponseSchema } from "./dto/loginResponseSchema.js";
import { loginSchema } from "./dto/loginSchema.js";
import { logoutSchema } from "./dto/logoutSchema.js";
import { refreshResponseSchema } from "./dto/refreshResponseSchema.js";
import { refreshSchema } from "./dto/refreshSchema.js";
import { registerResponseSchema } from "./dto/registerResponseSchema.js";
import { registerSchema } from "./dto/registerSchema.js";
import { AuthDtoMapper } from "./mappers/AuthDtoMapper.js";
import {
    requireUserId,
    type AppEnvironment,
} from "../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../shared/http/requestValidation.js";
import { success } from "../../../../shared/http/response.js";

import type { AuthService } from "../application/AuthService.js";
import type { Context } from "hono";

export class AuthController {
    constructor(private readonly authService: AuthService) { }

    async register(c: Context<AppEnvironment>) {
        const dto = await parseJsonBody(c, registerSchema);
        const connectionInfo = getConnInfo(c);
        const input = AuthDtoMapper.toRegisterInput(dto, {
            userAgent: c.req.header("user-agent") ?? null,
            ipAddress: connectionInfo.remote.address ?? null,
        });

        const result = await this.authService.register(input);
        const response = AuthDtoMapper.toRegisterResponse(result);
        const validatedResponse = registerResponseSchema.parse(response);

        return success(c, validatedResponse, 201);
    }

    async login(c: Context<AppEnvironment>) {
        const dto = await parseJsonBody(c, loginSchema);
        const connectionInfo = getConnInfo(c);
        const input = AuthDtoMapper.toLoginInput(dto, {
            userAgent: c.req.header("user-agent") ?? null,
            ipAddress: connectionInfo.remote.address ?? null,
        });

        const result = await this.authService.login(input);
        const response = AuthDtoMapper.toLoginResponse(result);
        const validatedResponse = loginResponseSchema.parse(response);

        return success(c, validatedResponse, 200);
    }

    async refresh(c: Context<AppEnvironment>) {
        const dto = await parseJsonBody(c, refreshSchema);
        const connectionInfo = getConnInfo(c);
        const input = AuthDtoMapper.toRefreshInput(dto, {
            userAgent: c.req.header("user-Agent") ?? null,
            ipAddress: connectionInfo.remote.address ?? null,
        });

        const result = await this.authService.refresh(input);
        const response = AuthDtoMapper.toRefreshResponse(result);
        const validatedResponse = refreshResponseSchema.parse(response);

        return success(c, validatedResponse, 200);
    }

    async logout(c: Context<AppEnvironment>) {
        const dto = await parseJsonBody(c, logoutSchema);

        await this.authService.logout(dto.refreshToken);

        return success(c, null, 200);
    }

    async logoutAll(c: Context<AppEnvironment>) {
        const userId = requireUserId(c);

        await this.authService.logoutAll(userId);

        return success(c, null, 200);
    }
}

export function createAuthController({
    authService,
}: {
    authService: AuthService;
}): AuthController {
    return new AuthController(authService);
}
