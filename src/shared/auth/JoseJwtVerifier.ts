import { jwtVerify } from "jose";

import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { AccessTokenPayload } from "./AccessTokenPayload.js";
import type { JwtVerifier } from "../middleware/AuthMiddleware.js";

export class JoseJwtVerifier implements JwtVerifier {
  private readonly secret: Uint8Array;

  constructor(jwtSecret: string) {
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is required");
    }

    this.secret = new TextEncoder().encode(jwtSecret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const { payload } = await jwtVerify(token, this.secret);

      if (!payload.sub) {
        throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized");
      }

      return {
        userId: payload.sub,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized");
    }
  }
}

export function createJwtVerifier(): JwtVerifier {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required");
  }

  return new JoseJwtVerifier(jwtSecret);
}
