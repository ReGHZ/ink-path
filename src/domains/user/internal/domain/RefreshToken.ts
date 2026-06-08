import { DomainError } from "../../../../shared/errors/DomainError.js";

export type RefreshTokenRevokedReason =
    | "logout"
    | "manual_revoke"
    | "rotation_reuse_detected";

export type RefreshTokenProperties = {
    id: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    parentTokenId: string | null;
    replacedByTokenId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
    revokedReason: RefreshTokenRevokedReason | null;
    lastUsedAt: Date | null;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: Date;
};

export type CreateRefreshTokenProperties = {
    id: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    parentTokenId?: string | null;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
    now: Date;
};

const REVOKED_REASONS: readonly RefreshTokenRevokedReason[] = [
    "logout",
    "manual_revoke",
    "rotation_reuse_detected",
];

export class RefreshToken {
    private constructor(private readonly props: RefreshTokenProperties) {
        RefreshToken.validate(props);
    }

    static create(props: CreateRefreshTokenProperties): RefreshToken {
        return new RefreshToken({
            id: props.id,
            userId: props.userId,
            tokenHash: props.tokenHash,
            familyId: props.familyId,
            parentTokenId: props.parentTokenId ?? null,
            replacedByTokenId: null,
            expiresAt: props.expiresAt,
            revokedAt: null,
            revokedReason: null,
            lastUsedAt: null,
            userAgent: props.userAgent ?? null,
            ipAddress: props.ipAddress ?? null,
            createdAt: props.now,
        });
    }

    static reconstitute(props: RefreshTokenProperties): RefreshToken {
        return new RefreshToken(props);
    }

    get id(): string {
        return this.props.id;
    }

    get userId(): string {
        return this.props.userId;
    }

    get tokenHash(): string {
        return this.props.tokenHash;
    }

    get familyId(): string {
        return this.props.familyId;
    }

    get parentTokenId(): string | null {
        return this.props.parentTokenId;
    }

    get replacedByTokenId(): string | null {
        return this.props.replacedByTokenId;
    }

    get expiresAt(): Date {
        return this.props.expiresAt;
    }

    get revokedAt(): Date | null {
        return this.props.revokedAt;
    }

    get revokedReason(): RefreshTokenRevokedReason | null {
        return this.props.revokedReason;
    }

    get lastUsedAt(): Date | null {
        return this.props.lastUsedAt;
    }

    get userAgent(): string | null {
        return this.props.userAgent;
    }

    get ipAddress(): string | null {
        return this.props.ipAddress;
    }

    get createdAt(): Date {
        return this.props.createdAt;
    }

    isExpired(now: Date): boolean {
        return now >= this.props.expiresAt;
    }

    isRevoked(): boolean {
        return this.props.revokedAt !== null;
    }

    isReplaced(): boolean {
        return this.props.replacedByTokenId !== null;
    }

    canBeUsed(now: Date): boolean {
        try {
            this.assertCanBeUsed(now);
            return true;
        } catch {
            return false;
        }
    }

    assertCanBeUsed(now: Date): void {
        if (this.isExpired(now)) {
            throw new DomainError("Refresh token is expired");
        }

        if (this.isReplaced()) {
            throw new DomainError("Refresh token is already replaced");
        }

        if (this.isRevoked()) {
            throw new DomainError("Refresh token is revoked");
        }
    }

    markUsed(now: Date): void {
        this.assertCanBeUsed(now);

        this.props.lastUsedAt = now;
    }

    revoke(reason: RefreshTokenRevokedReason, now: Date): void {
        RefreshToken.assertValidRevokedReason(reason);

        if (this.props.revokedAt !== null) {
            return;
        }

        this.props.revokedAt = now;
        this.props.revokedReason = reason;
    }

    rotateTo(replacementTokenId: string, now: Date): void {
        this.assertCanBeUsed(now);
        RefreshToken.assertNonEmpty(replacementTokenId, "Replacement token id is required");

        if (replacementTokenId === this.props.id) {
            throw new DomainError("Refresh token cannot replace itself");
        }

        this.props.replacedByTokenId = replacementTokenId;
        this.props.revokedAt = now;
        this.props.revokedReason = null;
        this.props.lastUsedAt = now;
    }

    markReuseDetected(now: Date): void {
        if (this.props.revokedAt !== null && this.props.revokedReason === null) {
            this.props.revokedReason = "rotation_reuse_detected";
            return;
        }

        this.revoke("rotation_reuse_detected", now);
    }

    toSnapshot(): RefreshTokenProperties {
        return { ...this.props };
    }

    private static validate(props: RefreshTokenProperties): void {
        RefreshToken.assertNonEmpty(props.id, "Refresh token id is required");
        RefreshToken.assertNonEmpty(props.userId, "Refresh token user id is required");
        RefreshToken.assertNonEmpty(props.tokenHash, "Refresh token hash is required");
        RefreshToken.assertNonEmpty(props.familyId, "Refresh token family id is required");

        if (props.parentTokenId !== null) {
            RefreshToken.assertNonEmpty(
                props.parentTokenId,
                "Parent refresh token id cannot be empty",
            );
        }

        if (props.replacedByTokenId !== null) {
            RefreshToken.assertNonEmpty(
                props.replacedByTokenId,
                "Replacement refresh token id cannot be empty",
            );
        }

        if (props.parentTokenId === props.id) {
            throw new DomainError("Refresh token cannot be its own parent");
        }

        if (props.replacedByTokenId === props.id) {
            throw new DomainError("Refresh token cannot replace itself");
        }

        if (props.expiresAt <= props.createdAt) {
            throw new DomainError("Refresh token expiry must be after creation");
        }

        if (props.lastUsedAt !== null && props.lastUsedAt < props.createdAt) {
            throw new DomainError("Refresh token last used time is invalid");
        }

        if (props.revokedAt !== null && props.revokedAt < props.createdAt) {
            throw new DomainError("Refresh token revocation time is invalid");
        }

        if (props.revokedReason !== null) {
            RefreshToken.assertValidRevokedReason(props.revokedReason);
        }

        if (props.revokedReason !== null && props.revokedAt === null) {
            throw new DomainError("Refresh token revocation reason requires revoked time");
        }

        if (props.replacedByTokenId !== null && props.revokedAt === null) {
            throw new DomainError("Replaced refresh token must be revoked");
        }

        if (
            props.revokedAt !== null &&
            props.revokedReason === null &&
            props.replacedByTokenId === null
        ) {
            throw new DomainError(
                "Revoked refresh token requires reason or replacement token",
            );
        }
    }

    private static assertNonEmpty(value: string, message: string): void {
        if (value.trim() === "") {
            throw new DomainError(message);
        }
    }

    private static assertValidRevokedReason(reason: RefreshTokenRevokedReason): void {
        if (!REVOKED_REASONS.includes(reason)) {
            throw new DomainError("Invalid refresh token revoked reason");
        }
    }
}
