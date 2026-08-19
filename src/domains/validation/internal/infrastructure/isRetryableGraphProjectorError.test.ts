import { describe, expect, it } from "vitest";

import { isRetryableGraphProjectorError } from "./isRetryableGraphProjectorError.js";
import { EvaluationGraphTransientError } from "../domain/EvaluationGraphError.js";

// The consumer's retry policy, and the LAYERING it depends on.
describe("isRetryableGraphProjectorError", () => {
  it("retries the one failure the ports promise is transient", () => {
    expect(
      isRetryableGraphProjectorError(
        new EvaluationGraphTransientError("upsertFact", new Error("40001")),
      ),
    ).toBe(true);
  });

  it("does NOT read Prisma codes — an untranslated transient dead-letters", () => {
    const untranslated = Object.assign(new Error("Prisma P2034"), {
      name: "PrismaClientKnownRequestError",
      code: "P2034",
    });

    // Deliberate, and the opposite of the embedding worker's classifier: retry policy
    // here reads a DOMAIN error, and translating vendor errors is the adapter's job
    // (`PrismaEvaluationGraphRepository`, `PrismaAssertionLogReader`). If this answered
    // `true`, the consumer would grow a second, competing notion of what is transient —
    // and the adapters' translation would stop being load-bearing without anything
    // going red.
    expect(isRetryableGraphProjectorError(untranslated)).toBe(false);
  });

  it("dead-letters a contract failure the fold raised itself", () => {
    // "the log does not have this row", "no fold for this routing key", "unary fact" —
    // none of them change on a second attempt.
    expect(
      isRetryableGraphProjectorError(
        new Error("GraphProjector received routing key … which it has no fold for"),
      ),
    ).toBe(false);
  });
});
