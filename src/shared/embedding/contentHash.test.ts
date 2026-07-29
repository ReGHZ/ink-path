import { describe, expect, it } from "vitest";

import { computeContentHash } from "./contentHash.js";

describe("computeContentHash", () => {
  it("is deterministic for the same text", () => {
    const text = "A wandering sage who speaks in riddles.";

    expect(computeContentHash(text)).toBe(computeContentHash(text));
  });

  it("differs for different text", () => {
    expect(computeContentHash("A wandering sage.")).not.toBe(
      computeContentHash("A settled sage."),
    );
  });

  it("produces a sha256 hex digest (64 lowercase hex characters)", () => {
    expect(computeContentHash("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
