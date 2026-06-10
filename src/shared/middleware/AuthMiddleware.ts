import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { AccessTokenPayload } from "../auth/AccessTokenPayload.js";
import type { AppEnvironment } from "../http/context.js";
import type { MiddlewareHandler } from "hono";

export type JwtVerifier = {
  verifyAccessToken(token: string): Promise<AccessTokenPayload>;
};

export function createAuthMiddleware(
  verifier: JwtVerifier,
): MiddlewareHandler<AppEnvironment> {
  return async (c, next) => {
    const authorization = c.req.header("Authorization");

    if (!authorization) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized");
    }

    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized");
    }

    const payload = await verifier.verifyAccessToken(token);

    c.set("userId", payload.userId);

    await next();
  };
}

export function createAppAuthMiddleware({
  jwtVerifier,
}: {
  jwtVerifier: JwtVerifier;
}): MiddlewareHandler<AppEnvironment> {
  return createAuthMiddleware(jwtVerifier);
}
