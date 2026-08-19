import { describe, expect, it } from "vitest";

import { PrismaEvaluationGraphRepository } from "./PrismaEvaluationGraphRepository.js";
import { EvaluationGraphTransientError } from "../domain/EvaluationGraphError.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { EvaluationGraphFact } from "../domain/EvaluationGraphRepository.js";

// What the port PROMISES its caller, which the integration test cannot reach: a
// database failure that a retry could fix arrives as one named domain error, and
// everything else keeps its own shape.
//
// It matters because of who reads the answer. The projector's consumer decides
// retry-vs-dead-letter from this translation alone (`isRetryableGraphProjectorError`),
// so a transient failure that surfaced untranslated would be dead-lettered — a fact
// dropped from the graph because Postgres blinked.
//
// Hand-built error shapes, the same tactic and the same limit as
// `PrismaContentRelationshipRepository.test.ts`: this pins the branching, not that
// Postgres raises these codes. A real P2002 needs a genuine race, which no fixture can
// schedule.
function prismaError(code: string): Error {
  return Object.assign(new Error(`Prisma ${code}`), {
    name: "PrismaClientKnownRequestError",
    code,
  });
}

const fact: EvaluationGraphFact = {
  projectId: "00000000-0000-4000-8000-0000000000a1",
  sourceAssertionId: "00000000-0000-4000-8000-0000000000a2",
  relationshipType: "ally_of",
  subject: { entityType: "character", entityId: "00000000-0000-4000-8000-0000000000ca" },
  object: { entityType: "character", entityId: "00000000-0000-4000-8000-0000000000cb" },
};

// Fails at the FIRST write of each path, which is enough: both paths wrap their whole
// body, and a translation that only covered part of it would leave the rest raw.
function clientRejecting(error: Error): PrismaClient {
  const transactionClient = {
    evaluationNode: { upsert: () => Promise.reject(error) },
    evaluationEdge: { upsert: () => Promise.resolve({ id: "unused" }) },
  };

  return {
    $transaction: (work: (tx: typeof transactionClient) => Promise<unknown>) =>
      work(transactionClient),
    evaluationEdge: { deleteMany: () => Promise.reject(error) },
  } as unknown as PrismaClient;
}

describe("PrismaEvaluationGraphRepository error translation", () => {
  it("reports a serialization failure as transient, keeping the cause", async () => {
    const cause = prismaError("P2034");
    const repository = new PrismaEvaluationGraphRepository(clientRejecting(cause));

    const error = await repository.upsertFact(fact).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(EvaluationGraphTransientError);
    // The DLQ log line is the only place a human reads this, so the original error has
    // to survive the wrapping.
    expect((error as Error).cause).toBe(cause);
    expect((error as Error).message).toContain("upsertFact");
  });

  it("reports a unique violation as transient — the fold's own policy", async () => {
    const repository = new PrismaEvaluationGraphRepository(
      clientRejecting(prismaError("P2002")),
    );

    // Every unique key this writer touches is an IDENTITY key, so a violation means a
    // concurrent fold wrote the row this attempt was writing and the retry will find it.
    // The shared helper deliberately answers `false` for P2002 — this composition is
    // what makes the reading local to the fold rather than global.
    await expect(repository.upsertFact(fact)).rejects.toBeInstanceOf(
      EvaluationGraphTransientError,
    );
  });

  it("lets a foreign key violation surface raw, so it dead-letters", async () => {
    const cause = prismaError("P2003");
    const repository = new PrismaEvaluationGraphRepository(clientRejecting(cause));

    // A predicate the project never defined, or an assertion from another project. No
    // retry fixes a disagreement between the fold and the log, and dressing it up as a
    // transient failure would spin it through the retry budget before the DLQ anyway.
    await expect(repository.upsertFact(fact)).rejects.toBe(cause);
  });

  it("translates the retraction path too, not only the write path", async () => {
    const repository = new PrismaEvaluationGraphRepository(
      clientRejecting(prismaError("P1001")),
    );

    // A retraction lost to a connection blip must be redelivered: leaving it
    // untranslated would dead-letter the one operation whose loss resurrects a fact the
    // author withdrew.
    const error = await repository
      .deleteFactBySourceAssertion({
        projectId: fact.projectId,
        sourceAssertionId: fact.sourceAssertionId,
      })
      .catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(EvaluationGraphTransientError);
    expect((error as Error).message).toContain("deleteFactBySourceAssertion");
  });
});
