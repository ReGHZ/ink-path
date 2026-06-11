import { describe, expect, it } from "vitest";

import { PrismaAuthUnitOfWork } from "./PrismaAuthUnitOfWork.js";

import type {
  Prisma,
  PrismaClient,
} from "../../../../generated/prisma/client.js";

type TransactionFunction = <T>(
  callback: (client: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

type PrismaClientStub = Pick<PrismaClient, "$transaction">;

function createSerializationFailure(): Error & { code: string } {
  return Object.assign(new Error("Serialization failure"), {
    code: "P2034",
  });
}

function createPrismaClientStub(transaction: TransactionFunction): PrismaClient {
  return {
    $transaction: transaction as PrismaClientStub["$transaction"],
  } as PrismaClient;
}

describe("PrismaAuthUnitOfWork", () => {
  it("retries serialization failures before returning the transaction result", async () => {
    let attempts = 0;
    const transaction: TransactionFunction = async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      attempts += 1;

      if (attempts < 3) {
        throw createSerializationFailure();
      }

      return callback({} as Prisma.TransactionClient);
    };
    const unitOfWork = new PrismaAuthUnitOfWork(
      createPrismaClientStub(transaction),
    );

    const result = await unitOfWork.transaction(() => Promise.resolve("ok"));

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("throws non-serialization failures without retrying", async () => {
    const failure = new Error("Database unavailable");
    let attempts = 0;
    const transaction: TransactionFunction = <T>(): Promise<T> => {
      attempts += 1;
      return Promise.reject(failure);
    };
    const unitOfWork = new PrismaAuthUnitOfWork(
      createPrismaClientStub(transaction),
    );

    await expect(
      unitOfWork.transaction(() => Promise.resolve("ok")),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });

  it("throws serialization failures after the retry budget is exhausted", async () => {
    let attempts = 0;
    const transaction: TransactionFunction = <T>(): Promise<T> => {
      attempts += 1;
      return Promise.reject(createSerializationFailure());
    };
    const unitOfWork = new PrismaAuthUnitOfWork(
      createPrismaClientStub(transaction),
    );

    await expect(
      unitOfWork.transaction(() => Promise.resolve("ok")),
    ).rejects.toMatchObject({ code: "P2034" });
    expect(attempts).toBe(3);
  });
});
