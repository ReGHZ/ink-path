import type { RefreshTokenRepository } from "../../domain/RefreshTokenRepository.js"
import type { UserRepository } from "../../domain/UserRepository.js"

export type AuthRepositories = {
    users: UserRepository
    refreshTokens: RefreshTokenRepository
}

export type AuthUnitOfWork = {
    transaction<T>(work: (repositories: AuthRepositories) => Promise<T>): Promise<T>
}