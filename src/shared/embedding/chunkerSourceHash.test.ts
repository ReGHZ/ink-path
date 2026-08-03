import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CHUNKER_MODULE_URL } from "./chunker.js";
import { computeChunkerSourceHash } from "./chunkerSourceHash.js";

describe("computeChunkerSourceHash", () => {
  it("returns a sha256 hex digest of chunker's own currently-executing file", () => {
    const expected = createHash("sha256")
      .update(readFileSync(new URL(CHUNKER_MODULE_URL)))
      .digest("hex");

    expect(computeChunkerSourceHash()).toBe(expected);
  });

  it("is deterministic across calls (memoized, not recomputed from disk each time)", () => {
    expect(computeChunkerSourceHash()).toBe(computeChunkerSourceHash());
  });

  it("returns a 64-character hex string", () => {
    expect(computeChunkerSourceHash()).toMatch(/^[\da-f]{64}$/);
  });
});
