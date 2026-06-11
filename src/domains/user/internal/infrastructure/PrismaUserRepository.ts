import { UserMapper } from "./UserMapper.js";
import {
  UserRepositoryConflictError,
  UserRepositoryNotFoundError,
} from "../domain/UserRepositoryError.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { User } from "../domain/User.js";
import type { UserRepository } from "../domain/UserRepository.js";

export type UserDatabase = Pick<PrismaClient, "user">;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly client: UserDatabase) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.client.user.findUnique({
      where: { id },
    });

    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.client.user.findUnique({
      where: { email },
    });

    return row ? UserMapper.toDomain(row) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = await this.client.user.findUnique({
      where: { username },
    });

    return row ? UserMapper.toDomain(row) : null;
  }

  async insert(user: User): Promise<void> {
    try {
      await this.client.user.create({
        data: {
          id: user.id,
          ...UserMapper.toPersistence(user),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UserRepositoryConflictError();
      }

      throw error;
    }
  }

  async update(user: User): Promise<void> {
    try {
      await this.client.user.update({
        where: {
          id: user.id,
        },
        data: UserMapper.toPersistence(user),
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new UserRepositoryNotFoundError();
      }

      throw error;
    }
  }
}

export function createUserRepository({
  client,
}: {
  client: PrismaClient;
}): UserRepository {
  return new PrismaUserRepository(client);
}
