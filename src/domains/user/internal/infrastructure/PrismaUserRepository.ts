import { toUserDomain, toUserPersistence } from "./UserMapper.js";
import { AppError } from "../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { User } from "../domain/User.js";
import type { UserRepository } from "../domain/UserRepository.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) { }

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toUserDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? toUserDomain(row) : null;
  }

  async insert(user: User): Promise<void> {
    try {
      await this.prisma.user.create({
        data: { id: user.id, ...toUserPersistence(user) },
      });
    } catch (error) {

      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.CONFLICT, "Email atau username sudah dipakai");
      }
      throw error;
    }
  }

  async update(user: User): Promise<void> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: toUserPersistence(user),
    });
  }
}

export function createUserRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): UserRepository {
  return new PrismaUserRepository(prisma);
}
