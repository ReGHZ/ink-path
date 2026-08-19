import { describe, expect, it } from "vitest";

import { isTransientDatabaseError } from "./prismaErrors.js";

// Hand-built error SHAPES, matching how this module reads them — by `code`/`name`, with
// no Prisma import. Same approach `PrismaContentRelationshipRepository.test.ts` takes
// for its P2002, and the same limit applies: this pins the branching, not that Postgres
// raises these codes for these situations.
function prismaError(code: string): unknown {
  return Object.assign(new Error(`Prisma ${code}`), {
    name: "PrismaClientKnownRequestError",
    code,
  });
}

describe("isTransientDatabaseError", () => {
  it.each(["P1001", "P1002", "P1017", "P2034", "P2024"])(
    "treats %s as transient",
    (code) => {
      expect(isTransientDatabaseError(prismaError(code))).toBe(true);
    },
  );

  it.each([
    "PrismaClientInitializationError",
    "PrismaClientUnknownRequestError",
  ])("treats %s as transient, matched by name", (name) => {
    expect(
      isTransientDatabaseError(Object.assign(new Error(name), { name })),
    ).toBe(true);
  });

  it("does NOT decide the unique-violation policy", () => {
    // P2002's meaning depends on whose unique key it is: a user-facing duplicate for the
    // CRUD surface, a converging write for a fold. Answering `true` here would push the
    // fold's policy onto every caller of this helper — the fold composes
    // `isUniqueViolation` itself instead (`PrismaEvaluationGraphRepository`).
    expect(isTransientDatabaseError(prismaError("P2002"))).toBe(false);
  });

  it("does not treat a foreign key violation as transient", () => {
    // For a fold, P2003 means the log or the vocabulary disagrees with what is being
    // folded. Retrying cannot fix a disagreement.
    expect(isTransientDatabaseError(prismaError("P2003"))).toBe(false);
  });

  it.each([
    ["a validation error", { name: "PrismaClientValidationError" }],
    ["an unrelated error", {}],
  ])("does not treat %s as transient", (_label, extra) => {
    expect(
      isTransientDatabaseError(Object.assign(new Error("nope"), extra)),
    ).toBe(false);
  });

  it("does not throw on values that are not errors at all", () => {
    expect(isTransientDatabaseError(null)).toBe(false);
    expect(isTransientDatabaseError("P2034")).toBe(false);
  });
});
