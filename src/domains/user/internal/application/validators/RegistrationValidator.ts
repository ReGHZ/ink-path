import { AppError } from "../../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";

import type { UserRepository } from "../../domain/UserRepository.js";

type AssertAvailableParameters = {
    email: string;
    username?: string | null;
};

export class RegistrationValidator {
    constructor(private readonly userRepository: UserRepository) { }

    async assertAvailable({ email, username }: AssertAvailableParameters): Promise<void> {
        const existingUser = await this.userRepository.findByEmail(email.trim().toLowerCase())

        if (existingUser) {
            throw new AppError(ErrorCode.CONFLICT, "Email already registered")
        }

        if (username) {
            const existingUserName = await this.userRepository.findByUsername(
                username.trim().toLowerCase()
            )

            if (existingUserName) {
                throw new AppError(ErrorCode.CONFLICT, "Username already registered")
            }
        }
    }
}

export function createRegistrationValidator({
    userRepository,
}: {
    userRepository: UserRepository
}): RegistrationValidator {
    return new RegistrationValidator(userRepository)
}