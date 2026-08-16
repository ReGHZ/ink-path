import { describe, expect, it } from "vitest";

import { isCanonicalUuid } from "./context.js";

// The accepted FORM is a decision, not an implementation detail: Postgres would
// also parse braced and dash-less literals, Prisma would not, and version bits
// say who minted an id rather than whether it can address a row. An e2e can only
// show "some bad value answers 404" — these cases pin which values count as bad.
// What the form is USED for now lives in projectScopedRouter.test.ts, with the
// middleware that applies it.
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
