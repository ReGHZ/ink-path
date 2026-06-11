import { PrismaRefreshTokenRepository } from "./PrismaRefreshTokenRepository.js";
import { PrismaUserRepository } from "./PrismaUserRepository.js";
import {
  Prisma,
  type PrismaClient,
} from "../../../../generated/prisma/client.js";

import type {
  AuthRepositories,
  AuthUnitOfWork,
} from "../application/ports/AuthUnitOfWork.js";

type TransactionClient = Prisma.TransactionClient;

const MAX_TRANSACTION_ATTEMPTS = 3;

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2034"
  );
}

export class PrismaAuthUnitOfWork implements AuthUnitOfWork {
  constructor(private readonly client: PrismaClient) {}

  async transaction<T>(
    work: (repositories: AuthRepositories) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        // The callback may run more than once after a serialization failure.
        // Keep external side effects outside this transaction boundary.
        return await this.client.$transaction(
          async (tx: TransactionClient) => {
            return work({
              users: new PrismaUserRepository(tx),
              refreshTokens: new PrismaRefreshTokenRepository(tx),
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        if (
          !isSerializationFailure(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
      }
    }

    throw new Error("Transaction retry loop exited unexpectedly");
  }
}

export function createAuthUnitOfWork({
  client,
}: {
  client: PrismaClient;
}): AuthUnitOfWork {
  return new PrismaAuthUnitOfWork(client);
}
