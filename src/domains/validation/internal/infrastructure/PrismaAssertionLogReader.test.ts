import { describe, expect, it } from "vitest";

import { PrismaAssertionLogReader } from "./PrismaAssertionLogReader.js";
import { EvaluationGraphTransientError } from "../domain/EvaluationGraphError.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";

// The READ side of the same promise the write side makes, and the more dangerous half:
// the projector treats a null row as "the log and the event disagree" and throws for it.
// So a read that failed because Postgres blinked MUST NOT come back as an ordinary
// failure — it has to be retryable, or the fact is dead-lettered for a reason that had
// nothing to do with the fact.
//
// The mapping itself (endpoints, nulls, tenancy scoping) is proven against a real
// database in `test/integration/evaluation-graph-repository.integration.test.ts`; only
// the translation needs a fake, because no fixture can make Postgres drop a connection.
function clientRejecting(error: Error): PrismaClient {
  return {
    transitionEffect: { findFirst: () => Promise.reject(error) },
  } as unknown as PrismaClient;
}

const input = {
  projectId: "00000000-0000-4000-8000-0000000000a1",
  assertionId: "00000000-0000-4000-8000-0000000000a2",
};

describe("PrismaAssertionLogReader error translation", () => {
  it("reports an unreachable database as transient", async () => {
    const cause = Object.assign(new Error("Prisma P1001"), {
      name: "PrismaClientKnownRequestError",
      code: "P1001",
    });
    const reader = new PrismaAssertionLogReader(clientRejecting(cause));

    const error = await reader
      .findAssertion(input)
      .catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(EvaluationGraphTransientError);
    expect((error as Error).cause).toBe(cause);
    expect((error as Error).message).toContain("findAssertion");
  });

  it("lets a code bug surface raw instead of retrying it three times", async () => {
    const cause = Object.assign(new Error("malformed query"), {
      name: "PrismaClientValidationError",
    });
    const reader = new PrismaAssertionLogReader(clientRejecting(cause));

    await expect(reader.findAssertion(input)).rejects.toBe(cause);
  });
});
