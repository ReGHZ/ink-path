import type { AccessTokenPayload } from "../../../../../shared/auth/AccessTokenPayload.js"


export type RefreshTokenSecret = {
    plainText: string
    hash: string
}

export type TokenService = {
    signAccessToken(input: AccessTokenPayload): Promise<string>
    generateRefreshToken(): RefreshTokenSecret
    hashRefreshToken(token: string): string
}