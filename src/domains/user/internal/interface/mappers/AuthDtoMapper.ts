import type {
  LoginInput,
  LoginResult,
  RefreshInput,
  RefreshAuthResult,
  RegisterInput,
  RegisterResult,
  SessionMetadata,
} from "../../application/AuthService.js";
import type { LoginResponseDto } from "../dto/loginResponseSchema.js";
import type { LoginRequestDto } from "../dto/loginSchema.js";
import type { RefreshResponseDto } from "../dto/refreshResponseSchema.js";
import type { RefreshRequestDto } from "../dto/refreshSchema.js";
import type { RegisterResponseDto } from "../dto/registerResponseSchema.js";
import type { RegisterRequestDto } from "../dto/registerSchema.js";

export const AuthDtoMapper = {
  toRegisterInput(
    dto: RegisterRequestDto,
    metadata: SessionMetadata,
  ): RegisterInput {
    return {
      email: dto.email,
      password: dto.password,
      username: dto.username,
      displayName: dto.displayName,
      ...metadata,
    };
  },

  toLoginInput(dto: LoginRequestDto, metadata: SessionMetadata): LoginInput {
    return {
      email: dto.email,
      password: dto.password,
      ...metadata,
    };
  },

  toRefreshInput(
    dto: RefreshRequestDto,
    metadata: SessionMetadata,
  ): RefreshInput {
    return {
      refreshToken: dto.refreshToken,
      ...metadata,
    };
  },

  toRegisterResponse(result: RegisterResult): RegisterResponseDto {
    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        displayName: result.user.displayName,
      },
    };
  },

  toLoginResponse(result: LoginResult): LoginResponseDto {
    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        displayName: result.user.displayName,
      },
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  },

  toRefreshResponse(result: RefreshAuthResult): RefreshResponseDto {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  },
};
