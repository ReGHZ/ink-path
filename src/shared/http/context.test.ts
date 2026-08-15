import { describe, expect, it } from "vitest";

import {
  isCanonicalUuid,
  requireUuidRouteParameter,
  type AppEnvironment,
} from "./context.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { Context } from "hono";

// The accepted FORM is a decision, not an implementation detail: Postgres would
// also parse braced and dash-less literals, Prisma would not, and version bits
// say who minted an id rather than whether it can address a row. An e2e can only
// show "some bad value answers 404" — these cases pin which values count as bad.
describe("isCanonicalUuid", () => {
  it.each([
    ["11111111-1111-4111-8111-111111111111", "canonical v4"],
    ["11111111-1111-1111-8111-111111111111", "canonical, non-v4 version nibble"],
    ["11111111-1111-4111-C111-111111111111", "non-RFC variant nibble"],
    ["AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", "uppercase hex"],
  ])("accepts %s (%s)", (value) => {
    expect(isCanonicalUuid(value)).toBe(true);
  });

  it.each([
    ["not-a-uuid", "plainly not an id"],
    ["undefined", "the classic frontend interpolation bug"],
    ["11111111111141118111111111111111", "no dashes — Postgres would take it"],
    ["{11111111-1111-4111-8111-111111111111}", "braced — Postgres would too"],
    ["11111111-1111-4111-8111-11111111111", "one hex digit short"],
    ["11111111-1111-4111-8111-1111111111111", "one hex digit too many"],
    ["11111111-1111-4111-8111-11111111111g", "non-hex character"],
    [" 11111111-1111-4111-8111-111111111111", "leading whitespace"],
    ["", "empty"],
  ])("rejects %s (%s)", (value) => {
    expect(isCanonicalUuid(value)).toBe(false);
  });
});

// Minimal stub instead of a real Hono context: the only collaborator this
// function has is `c.req.param`, and building a live context would test Hono.
function contextWithParameter(value: string | undefined) {
  return {
    req: { param: () => value },
  } as unknown as Context<AppEnvironment>;
}

describe("requireUuidRouteParameter", () => {
  it("returns the value unchanged when it is a canonical uuid", () => {
    const id = "11111111-1111-4111-8111-111111111111";

    expect(
      requireUuidRouteParameter(
        contextWithParameter(id),
        "relationshipId",
        "Relationship not found",
      ),
    ).toBe(id);
  });

  // Typed as one tuple shape rather than inferred: without it the array widens
  // to a union of tuples and the callback cannot destructure a single value.
  const rejected: Array<[string | undefined, string]> = [
    ["not-a-uuid", "malformed"],
    [undefined, "absent"],
  ];

  it.each(rejected)(
    "throws the caller's 404 for %s (%s), never a distinguishable error",
    (value: string | undefined) => {
      // Malformed and absent must be INDISTINGUISHABLE to the client — same
      // code, same message — or the shape of an id becomes a way to probe what
      // exists. This is also why it is 404 and not 400.
      let thrown: unknown;

      try {
        requireUuidRouteParameter(
          contextWithParameter(value),
          "relationshipId",
          "Relationship not found",
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe(ErrorCode.NOT_FOUND);
      expect((thrown as AppError).message).toBe("Relationship not found");
    },
  );
});
