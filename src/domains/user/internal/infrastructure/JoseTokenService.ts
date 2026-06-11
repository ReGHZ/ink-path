import { createHash, randomBytes } from "node:crypto";

import { SignJWT } from "jose";

import type { AccessTokenPayload } from "../../../../shared/auth/AccessTokenPayload.js";
import type {
  RefreshTokenSecret,
  TokenService,
} from "../application/ports/TokenService.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_BYTES = 48;

export class JoseTokenService implements TokenService {
  private readonly secret: Uint8Array;

  constructor(jwtSecret: string) {
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is required");
    }

    this.secret = new TextEncoder().encode(jwtSecret);
  }

  async signAccessToken(input: AccessTokenPayload): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(input.userId)
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_TTL)
      .sign(this.secret);
  }

  generateRefreshToken(): RefreshTokenSecret {
    const plainText = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");

    return {
      plainText,
      hash: this.hashRefreshToken(plainText),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }
}

export function createJoseTokenService(): TokenService {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required");
  }

  return new JoseTokenService(jwtSecret);
}
