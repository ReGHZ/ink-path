import { AppError } from "../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../shared/errors/DomainErrorCode.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";
import { RefreshToken } from "../domain/RefreshToken.js";
import { User } from "../domain/User.js";

import type { RefreshTokenRepository } from "../domain/RefreshTokenRepository.js";
import type { UserRepository } from "../domain/UserRepository.js";
import type { AuthUnitOfWork } from "./ports/AuthUnitOfWork.js";
import type { Clock } from "./ports/Clock.js";
import type { IdGenerator } from "./ports/IdGenerator.js";
import type { PasswordHasher } from "./ports/PasswordHasher.js";
import type { TokenService } from "./ports/TokenService.js";
import type { RegistrationValidator } from "./validators/RegistrationValidator.js";

export type SessionMetadata = {
    userAgent?: string | null
    ipAddress?: string | null
}

export type RegisterInput = {
    email: string
    password: string
    username?: string | null
    displayName?: string | null
} & SessionMetadata

export type RegisterResult = {
    user: {
        id: string
        email: string
        username: string | null
        displayName: string | null
    }
}

export type LoginInput = {
    email: string;
    password: string;
} & SessionMetadata;

export type LoginResult = {
    user: {
        id: string
        email: string
        username: string | null
        displayName: string | null
    }
    accessToken: string
    refreshToken: string
}

export type RefreshInput = {
    refreshToken: string
} & SessionMetadata

export type RefreshAuthResult = {
    accessToken: string
    refreshToken: string
}

type RefreshResult =
    | { status: "invalid" }
    | {
        status: "ok"
        result: {
            userId: string
            refreshToken: string
        }
    }

type CreatedSession = {
    user: User
    refreshToken: string
}

const REFRESH_TOKEN_TTL_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function createRefreshTokenExpiry(now: Date): Date {
    return new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY);
}
function mapLoginDomainError(error: unknown): never {
    if (error instanceof DomainError) {
        if (error.code === DomainErrorCode.EMAIL_NOT_VERIFIED) {
            throw new AppError(ErrorCode.FORBIDDEN, "Please verify your email");
        }

        if (error.code === DomainErrorCode.USER_DISABLED) {
            throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials");
        }

        if (error.code === DomainErrorCode.USER_DELETED) {
            throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials");
        }

        throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials");
    }

    throw error;
}

export class AuthService {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly registrationValidator: RegistrationValidator,
        private readonly passwordHasher: PasswordHasher,
        private readonly tokenService: TokenService,
        private readonly idGenerator: IdGenerator,
        private readonly clock: Clock,
        private readonly unitOfWork: AuthUnitOfWork,
    ) { }

    async register(input: RegisterInput): Promise<RegisterResult> {
        const now = this.clock.now()
        const email = normalizeEmail(input.email)

        await this.registrationValidator.assertAvailable({
            email,
            username: input.username,
        })


        const passwordHash = await this.passwordHasher.hash(input.password)

        const user = User.create({
            id: this.idGenerator.generate(),
            email,
            username: input.username,
            passwordHash,
            displayName: input.displayName,
            now
        })

        user.verifyEmail(now) //TODO: delete later for flow email verify

        await this.unitOfWork.transaction(async (repositories) => {
            await repositories.users.insert(user)
        })

        return {
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                displayName: user.displayName,
            },
        }
    }

    async login(input: LoginInput): Promise<LoginResult> {
        const email = normalizeEmail(input.email);
        const user = await this.userRepository.findByEmail(email);


        if (!user) {
            throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials");
        }

        try {
            user.assertCanLogin()
        } catch (error) {
            mapLoginDomainError(error)
        }

        const passwordHash = user.getPasswordHash();

        if (!passwordHash) {
            throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials");
        }

        const passwordMatches = await this.passwordHasher.compare(
            input.password,
            passwordHash,
        );

        if (!passwordMatches) {
            throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials");
        }

        const now = this.clock.now()
        user.markLoggedIn(now)

        const session = await this.unitOfWork.transaction(async (repositories) => {
            await repositories.users.update(user)
            return this.createSession(repositories.refreshTokens, user, input, now)
        })
        const accessToken = await this.tokenService.signAccessToken({
            userId: session.user.id
        })

        return {
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                displayName: user.displayName,
            },
            accessToken,
            refreshToken: session.refreshToken,
        }
    }

    async refresh(input: RefreshInput): Promise<RefreshAuthResult> {
        const oldTokenHash = this.tokenService.hashRefreshToken(input.refreshToken)
        const now = this.clock.now()

        const refreshResult = await this.unitOfWork.transaction<RefreshResult>(
            async (repositories) => {
                const oldToken =
                    await repositories.refreshTokens.findByTokenHash(oldTokenHash)

                if (!oldToken) {
                    return { status: "invalid" }
                }

                if (oldToken.isReplaced()) {
                    await this.revokeTokenFamily(
                        repositories.refreshTokens,
                        oldToken.familyId,
                        now,
                    )

                    return { status: "invalid" }
                }

                if (!oldToken.canBeUsed(now)) {
                    return { status: "invalid" }
                }

                const refreshToken = this.tokenService.generateRefreshToken()

                const replacementToken = RefreshToken.create({
                    id: this.idGenerator.generate(),
                    userId: oldToken.userId,
                    tokenHash: refreshToken.hash,
                    familyId: oldToken.familyId,
                    parentTokenId: oldToken.id,
                    expiresAt: createRefreshTokenExpiry(now),
                    userAgent: input.userAgent,
                    ipAddress: input.ipAddress,
                    now,
                })

                oldToken.rotateTo(replacementToken.id, now)

                await repositories.refreshTokens.insert(replacementToken)
                await repositories.refreshTokens.update(oldToken)

                return {
                    status: "ok",
                    result: {
                        userId: oldToken.userId,
                        refreshToken: refreshToken.plainText,
                    },
                }
            },
        )

        if (refreshResult.status === "invalid") {
            throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid refresh token")
        }

        const accessToken = await this.tokenService.signAccessToken({
            userId: refreshResult.result.userId,
        })

        return {
            accessToken,
            refreshToken: refreshResult.result.refreshToken,
        }
    }

    async logout(refreshToken: string): Promise<void> {
        const tokenHash = this.tokenService.hashRefreshToken(refreshToken)
        const now = this.clock.now()

        await this.unitOfWork.transaction(async (repositories) => {
            const token = await repositories.refreshTokens.findByTokenHash(tokenHash)

            if (!token) {
                return
            }

            token.revoke("logout", now)
            await repositories.refreshTokens.update(token)
        })
    }

    async logoutAll(userId: string): Promise<void> {
        const now = this.clock.now()

        await this.unitOfWork.transaction(async (repositories) => {
            const tokens = await repositories.refreshTokens.findActiveByUserId(userId)

            await Promise.all(
                tokens.map(async (token) => {
                    token.revoke("logout", now)
                    await repositories.refreshTokens.update(token)
                })
            )
        })
    }

    private async createSession(
        refreshTokens: RefreshTokenRepository,
        user: User,
        metadata: SessionMetadata,
        now: Date,
    ): Promise<CreatedSession> {
        const refreshToken = this.tokenService.generateRefreshToken();
        const familyId = this.idGenerator.generate();
        const token = RefreshToken.create({
            id: this.idGenerator.generate(),
            userId: user.id,
            tokenHash: refreshToken.hash,
            familyId,
            expiresAt: createRefreshTokenExpiry(now),
            userAgent: metadata.userAgent,
            ipAddress: metadata.ipAddress,
            now,
        });

        await refreshTokens.insert(token);

        return {
            user,
            refreshToken: refreshToken.plainText,
        };
    }

    private async revokeTokenFamily(
        refreshTokens: RefreshTokenRepository,
        familyId: string,
        now: Date,
    ): Promise<void> {
        const familyTokens = await refreshTokens.findActiveByFamilyId(familyId);

        await Promise.all(
            familyTokens.map(async (token) => {
                token.markReuseDetected(now);
                await refreshTokens.update(token);
            }),
        );
    }
}

export function createAuthService({
    userRepository,
    registrationValidator,
    passwordHasher,
    tokenService,
    idGenerator,
    clock,
    authUnitOfWork
}: {
    userRepository: UserRepository
    registrationValidator: RegistrationValidator
    passwordHasher: PasswordHasher
    tokenService: TokenService
    idGenerator: IdGenerator
    clock: Clock
    authUnitOfWork: AuthUnitOfWork
}): AuthService {
    return new AuthService(
        userRepository,
        registrationValidator,
        passwordHasher,
        tokenService,
        idGenerator,
        clock,
        authUnitOfWork
    )
}
