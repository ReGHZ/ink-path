import { describe, expect, it } from "vitest";

import { AuthService } from "./AuthService.js";
import { RegistrationValidator } from "./validators/RegistrationValidator.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";
import { User } from "../domain/User.js";
import { UserRepositoryConflictError } from "../domain/UserRepositoryError.js";

import type { AccessTokenPayload } from "../../../../shared/auth/AccessTokenPayload.js";
import type { RefreshToken } from "../domain/RefreshToken.js";
import type { RefreshTokenRepository } from "../domain/RefreshTokenRepository.js";
import type { UserRepository } from "../domain/UserRepository.js";
import type {
  AuthRepositories,
  AuthUnitOfWork,
} from "./ports/AuthUnitOfWork.js";
import type { Clock } from "./ports/Clock.js";
import type { IdGenerator } from "./ports/IdGenerator.js";
import type { PasswordHasher } from "./ports/PasswordHasher.js";
import type { TokenService } from "./ports/TokenService.js";

const now = new Date("2026-06-08T00:00:00.000Z");

class FakeUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  failNextInsertWithConflict = false;

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(
      [...this.users.values()].find((user) => user.email === email) ?? null,
    );
  }

  findByUsername(username: string): Promise<User | null> {
    return Promise.resolve(
      [...this.users.values()].find((user) => user.username === username) ??
        null,
    );
  }

  insert(user: User): Promise<void> {
    if (this.failNextInsertWithConflict) {
      this.failNextInsertWithConflict = false;
      return Promise.reject(new UserRepositoryConflictError());
    }

    this.users.set(user.id, user);
    return Promise.resolve();
  }

  update(user: User): Promise<void> {
    this.users.set(user.id, user);
    return Promise.resolve();
  }
}

class FakeRefreshTokenRepository implements RefreshTokenRepository {
  readonly tokens = new Map<string, RefreshToken>();

  findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return Promise.resolve(
      [...this.tokens.values()].find(
        (token) => token.tokenHash === tokenHash,
      ) ?? null,
    );
  }

  findActiveByFamilyId(familyId: string, now: Date): Promise<RefreshToken[]> {
    return Promise.resolve(
      [...this.tokens.values()].filter(
        (token) => token.familyId === familyId && token.canBeUsed(now),
      ),
    );
  }

  findActiveByUserId(userId: string, now: Date): Promise<RefreshToken[]> {
    return Promise.resolve(
      [...this.tokens.values()].filter(
        (token) => token.userId === userId && token.canBeUsed(now),
      ),
    );
  }

  insert(token: RefreshToken): Promise<void> {
    this.tokens.set(token.id, token);
    return Promise.resolve();
  }

  update(token: RefreshToken): Promise<void> {
    this.tokens.set(token.id, token);
    return Promise.resolve();
  }
}

class FakeUnitOfWork implements AuthUnitOfWork {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async transaction<T>(
    work: (repositories: AuthRepositories) => Promise<T>,
  ): Promise<T> {
    return work({
      users: this.users,
      refreshTokens: this.refreshTokens,
    });
  }
}

class FakeIdGenerator implements IdGenerator {
  private nextId = 1;

  generate(): string {
    const id = `00000000-0000-4000-8000-${String(this.nextId).padStart(12, "0")}`;
    this.nextId += 1;
    return id;
  }
}

const clock: Clock = {
  now: () => now,
};

const passwordHasher: PasswordHasher = {
  hash: (password) => Promise.resolve(`hashed:${password}`),
  compare: (password, hash) => Promise.resolve(hash === `hashed:${password}`),
};

class FakeTokenService implements TokenService {
  private nextToken = 1;

  signAccessToken(input: AccessTokenPayload): Promise<string> {
    return Promise.resolve(`access:${input.userId}`);
  }

  generateRefreshToken() {
    const plainText = `refresh-${this.nextToken}`;
    this.nextToken += 1;

    return {
      plainText,
      hash: this.hashRefreshToken(plainText),
    };
  }

  hashRefreshToken(token: string): string {
    return `hash:${token}`;
  }
}

function createService() {
  const users = new FakeUserRepository();
  const refreshTokens = new FakeRefreshTokenRepository();

  return {
    users,
    refreshTokens,
    service: new AuthService(
      users,
      new RegistrationValidator(users),
      passwordHasher,
      new FakeTokenService(),
      new FakeIdGenerator(),
      clock,
      new FakeUnitOfWork(users, refreshTokens),
    ),
  };
}

async function getRegisteredUser(
  users: UserRepository,
  email: string,
): Promise<User> {
  const user = await users.findByEmail(email);

  if (!user) {
    throw new Error("Expected registered user to exist");
  }

  return user;
}

describe("AuthService", () => {
  it("registers a verified user without creating a session", async () => {
    const { refreshTokens, service, users } = createService();

    const result = await service.register({
      email: "Writer@Example.COM",
      password: "correct-password",
      displayName: "Writer",
    });

    expect(result.user.email).toBe("writer@example.com");

    const user = await getRegisteredUser(users, "writer@example.com");

    expect(user.emailVerifiedAt).toEqual(now);
    expect(user.canLogin()).toBe(true);
    expect(refreshTokens.tokens.size).toBe(0);
  });

  it("rejects register with duplicate email", async () => {
    const { service } = createService();

    await service.register({
      email: "Writer@Example.COM",
      password: "correct-password",
    });

    await expect(
      service.register({
        email: "writer@example.com",
        password: "another-password",
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "Email already registered",
    });
  });

  it("maps persistence conflict race backstop to CONFLICT", async () => {
    const { service, users } = createService();
    users.failNextInsertWithConflict = true;

    await expect(
      service.register({
        email: "writer@example.com",
        password: "correct-password",
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "Email or username already registered",
    });
  });

  it("logs in a verified user and creates a refresh token session", async () => {
    const { refreshTokens, service } = createService();

    await service.register({
      email: "writer@example.com",
      password: "correct-password",
    });

    const result = await service.login({
      email: "writer@example.com",
      password: "correct-password",
    });

    expect(result.accessToken).toBe(`access:${result.user.id}`);
    expect(result.refreshToken).toBe("refresh-1");
    expect(refreshTokens.tokens.size).toBe(1);
  });

  it("rejects login for unverified user with flow-specified forbidden error", async () => {
    const { service, users } = createService();

    await users.insert(
      User.create({
        id: "user-1",
        email: "writer@example.com",
        passwordHash: "hashed:correct-password",
        now,
      }),
    );

    await expect(
      service.login({
        email: "writer@example.com",
        password: "correct-password",
      }),
    ).rejects.toThrow("Please verify your email");
  });

  it("rejects login with invalid password", async () => {
    const { service } = createService();

    await service.register({
      email: "writer@example.com",
      password: "correct-password",
    });

    await expect(
      service.login({
        email: "writer@example.com",
        password: "wrong-password",
      }),
    ).rejects.toThrow("Invalid credentials");
  });

  it("rejects unverified user before password comparison", async () => {
    const { service, users } = createService();

    await users.insert(
      User.create({
        id: "user-1",
        email: "writer@example.com",
        passwordHash: "hashed:correct-password",
        now,
      }),
    );

    // Current auth flow checks email verification before password comparison.
    await expect(
      service.login({
        email: "writer@example.com",
        password: "wrong-password",
      }),
    ).rejects.toThrow("Please verify your email");
  });

  it("revokes the whole family when an already-rotated token is reused", async () => {
    const { refreshTokens, service } = createService();

    await service.register({
      email: "writer@example.com",
      password: "correct-password",
    });

    const session = await service.login({
      email: "writer@example.com",
      password: "correct-password",
    });

    const rotated = await service.refresh({
      refreshToken: session.refreshToken,
    });

    // Reuse of the original (now replaced) token is the theft signal.
    await expect(
      service.refresh({ refreshToken: session.refreshToken }),
    ).rejects.toThrow("Invalid refresh token");

    const stored = [...refreshTokens.tokens.values()];
    expect(
      stored.some((token) => token.revokedReason === "rotation_reuse_detected"),
    ).toBe(true);

    // The latest rotated token is now part of the revoked family.
    await expect(
      service.refresh({ refreshToken: rotated.refreshToken }),
    ).rejects.toThrow("Invalid refresh token");
  });

  it("does not flag the family as reuse when a logged-out token is presented again", async () => {
    const { refreshTokens, service } = createService();

    await service.register({
      email: "writer@example.com",
      password: "correct-password",
    });

    const session = await service.login({
      email: "writer@example.com",
      password: "correct-password",
    });

    await service.logout(session.refreshToken);

    // A logged-out token is benign, not theft: rejected, but the family is
    // never relabeled as rotation_reuse_detected.
    await expect(
      service.refresh({ refreshToken: session.refreshToken }),
    ).rejects.toThrow("Invalid refresh token");

    const stored = [...refreshTokens.tokens.values()];
    expect(stored.every((token) => token.revokedReason === "logout")).toBe(
      true,
    );
  });

  it("keeps logout idempotent when refresh token does not exist", async () => {
    const { refreshTokens, service } = createService();

    await expect(
      service.logout("missing-refresh-token"),
    ).resolves.toBeUndefined();

    expect(refreshTokens.tokens.size).toBe(0);
  });

  it("keeps logout idempotent when called twice with the same token", async () => {
    const { refreshTokens, service } = createService();

    await service.register({
      email: "writer@example.com",
      password: "correct-password",
    });

    const session = await service.login({
      email: "writer@example.com",
      password: "correct-password",
    });

    await service.logout(session.refreshToken);
    await expect(service.logout(session.refreshToken)).resolves.toBeUndefined();

    const stored = [...refreshTokens.tokens.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.revokedReason).toBe("logout");
  });
});
