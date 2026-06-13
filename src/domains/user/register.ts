import { asFunction, asValue, type AwilixContainer } from "awilix";

import {
  createAuthService,
  type AuthService,
} from "./internal/application/AuthService.js";
import {
  createUserService,
  type UserService,
} from "./internal/application/UserService.js";
import {
  createRegistrationValidator,
  type RegistrationValidator,
} from "./internal/application/validators/RegistrationValidator.js";
import { createArgon2PasswordHasher } from "./internal/infrastructure/Argon2PasswordHasher.js";
import { createJoseTokenService } from "./internal/infrastructure/JoseTokenService.js";
import { createAuthUnitOfWork } from "./internal/infrastructure/PrismaAuthUnitOfWork.js";
import { createRefreshTokenRepository } from "./internal/infrastructure/PrismaRefreshTokenRepository.js";
import { createUserRepository } from "./internal/infrastructure/PrismaUserRepository.js";
import { createSystemClock } from "./internal/infrastructure/SystemClock.js";
import { createUuidGenerator } from "./internal/infrastructure/UuidGenerator.js";
import {
  createAuthController,
  type AuthController,
} from "./internal/interface/AuthController.js";
import {
  createUserController,
  type UserController,
} from "./internal/interface/UserController.js";

import type { AuthUnitOfWork } from "./internal/application/ports/AuthUnitOfWork.js";
import type { Clock } from "./internal/application/ports/Clock.js";
import type { IdGenerator } from "./internal/application/ports/IdGenerator.js";
import type { PasswordHasher } from "./internal/application/ports/PasswordHasher.js";
import type { TokenService } from "./internal/application/ports/TokenService.js";
import type { RefreshTokenRepository } from "./internal/domain/RefreshTokenRepository.js";
import type { UserRepository } from "./internal/domain/UserRepository.js";

const argon2PasswordHasherConfig = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export type UserDomainCradle = {
  argon2PasswordHasherConfig: typeof argon2PasswordHasherConfig;
  authUnitOfWork: AuthUnitOfWork;
  userRepository: UserRepository;
  refreshTokenRepository: RefreshTokenRepository;
  registrationValidator: RegistrationValidator;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  idGenerator: IdGenerator;
  clock: Clock;
  authService: AuthService;
  userService: UserService;
  authController: AuthController;
  userController: UserController;
};

export function registerUserDomain(
  container: AwilixContainer<UserDomainCradle>,
): void {
  container.register({
    argon2PasswordHasherConfig: asValue(argon2PasswordHasherConfig),
    authUnitOfWork: asFunction(createAuthUnitOfWork).singleton(),
    userRepository: asFunction(createUserRepository).singleton(),
    refreshTokenRepository: asFunction(
      createRefreshTokenRepository,
    ).singleton(),
    registrationValidator: asFunction(createRegistrationValidator).singleton(),
    passwordHasher: asFunction(createArgon2PasswordHasher).singleton(),
    tokenService: asFunction(createJoseTokenService).singleton(),
    idGenerator: asFunction(createUuidGenerator).singleton(),
    clock: asFunction(createSystemClock).singleton(),
    authService: asFunction(createAuthService).singleton(),
    userService: asFunction(createUserService).singleton(),
    authController: asFunction(createAuthController).singleton(),
    userController: asFunction(createUserController).singleton(),
  });
}
