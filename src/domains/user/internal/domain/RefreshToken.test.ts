import { describe, expect, it } from "vitest";

import { RefreshToken } from "./RefreshToken.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";

const now = new Date("2026-06-08T00:00:00.000Z");
const later = new Date("2026-06-08T01:00:00.000Z");
const expiresAt = new Date("2026-07-08T00:00:00.000Z");

type RefreshTokenSnapshot = Parameters<typeof RefreshToken.reconstitute>[0];

const baseRefreshTokenSnapshot: RefreshTokenSnapshot = {
    id: "token-1",
    userId: "user-1",
    tokenHash: "hashed-refresh-token",
    familyId: "family-1",
    parentTokenId: null,
    replacedByTokenId: null,
    expiresAt,
    revokedAt: null,
    revokedReason: null,
    lastUsedAt: null,
    userAgent: null,
    ipAddress: null,
    createdAt: now,
};

function createRefreshToken(): RefreshToken {
    return RefreshToken.create({
        id: "token-1",
        userId: "user-1",
        tokenHash: "hashed-refresh-token",
        familyId: "family-1",
        expiresAt,
        userAgent: "Vitest",
        ipAddress: "127.0.0.1",
        now,
    });
}

function reconstituteRefreshToken(
    overrides: Partial<RefreshTokenSnapshot> = {},
): RefreshToken {
    return RefreshToken.reconstitute({
        ...baseRefreshTokenSnapshot,
        ...overrides,
    });
}

describe("RefreshToken", () => {
    it("creates active refresh token with session metadata", () => {
        const token = createRefreshToken();

        expect(token.id).toBe("token-1");
        expect(token.userId).toBe("user-1");
        expect(token.familyId).toBe("family-1");
        expect(token.parentTokenId).toBeNull();
        expect(token.replacedByTokenId).toBeNull();
        expect(token.userAgent).toBe("Vitest");
        expect(token.ipAddress).toBe("127.0.0.1");
        expect(token.canBeUsed(now)).toBe(true);
    });

    it("rejects empty required fields", () => {
        expect(() => {
            RefreshToken.create({
                id: " ",
                userId: "user-1",
                tokenHash: "hashed-refresh-token",
                familyId: "family-1",
                expiresAt,
                now,
            });
        }).toThrow(DomainError);
    });

    it("rejects expiry that is not after creation", () => {
        expect(() => {
            RefreshToken.create({
                id: "token-1",
                userId: "user-1",
                tokenHash: "hashed-refresh-token",
                familyId: "family-1",
                expiresAt: now,
                now,
            });
        }).toThrow("Refresh token expiry must be after creation");
    });

    it("marks token as used", () => {
        const token = createRefreshToken();

        token.markUsed(later);

        expect(token.lastUsedAt).toEqual(later);
    });

    it("does not allow expired token to be used", () => {
        const token = createRefreshToken();
        const afterExpiry = new Date("2026-07-09T00:00:00.000Z");

        expect(token.isExpired(afterExpiry)).toBe(true);
        expect(token.canBeUsed(afterExpiry)).toBe(false);
        expect(() => {
            token.assertCanBeUsed(afterExpiry);
        }).toThrow("Refresh token is expired");
    });

    it("revokes token with explicit reason", () => {
        const token = createRefreshToken();

        token.revoke("logout", later);

        expect(token.revokedAt).toEqual(later);
        expect(token.revokedReason).toBe("logout");
        expect(token.canBeUsed(later)).toBe(false);
    });

    it("keeps revocation idempotent", () => {
        const token = createRefreshToken();

        token.revoke("logout", now);
        token.revoke("manual_revoke", later);

        expect(token.revokedAt).toEqual(now);
        expect(token.revokedReason).toBe("logout");
    });

    it("rotates token to replacement token", () => {
        const token = createRefreshToken();

        token.rotateTo("token-2", later);

        expect(token.replacedByTokenId).toBe("token-2");
        expect(token.revokedAt).toEqual(later);
        expect(token.revokedReason).toBeNull();
        expect(token.lastUsedAt).toEqual(later);
        expect(token.canBeUsed(later)).toBe(false);
    });

    it("does not allow token to replace itself", () => {
        const token = createRefreshToken();

        expect(() => {
            token.rotateTo("token-1", later);
        }).toThrow("Refresh token cannot replace itself");
    });

    it("does not allow revoked token to rotate", () => {
        const token = createRefreshToken();

        token.revoke("logout", later);

        expect(() => {
            token.rotateTo("token-2", later);
        }).toThrow("Refresh token is revoked");
    });

    it("marks active token reuse as security revocation", () => {
        const token = createRefreshToken();

        token.markReuseDetected(later);

        expect(token.revokedAt).toEqual(later);
        expect(token.revokedReason).toBe("rotation_reuse_detected");
    });

    it("marks rotated token reuse without losing replacement link", () => {
        const token = createRefreshToken();

        token.rotateTo("token-2", later);
        token.markReuseDetected(later);

        expect(token.replacedByTokenId).toBe("token-2");
        expect(token.revokedAt).toEqual(later);
        expect(token.revokedReason).toBe("rotation_reuse_detected");
    });

    it("rejects revoked persisted state without reason or replacement", () => {
        expect(() => {
            reconstituteRefreshToken({
                revokedAt: later,
            });
        }).toThrow("Revoked refresh token requires reason or replacement token");
    });

    it("rejects replacement state without revocation time", () => {
        expect(() => {
            reconstituteRefreshToken({
                replacedByTokenId: "token-2",
            });
        }).toThrow("Replaced refresh token must be revoked");
    });

    it("rejects invalid persisted revoked reason", () => {
        expect(() => {
            reconstituteRefreshToken({
                revokedAt: later,
                revokedReason: "invalid_reason" as RefreshTokenSnapshot["revokedReason"],
            });
        }).toThrow("Invalid refresh token revoked reason");
    });
});
