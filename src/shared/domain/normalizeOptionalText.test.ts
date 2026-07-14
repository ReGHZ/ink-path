import { describe, expect, it } from "vitest";

import { normalizeOptionalText } from "./normalizeOptionalText.js";

describe("normalizeOptionalText", () => {
  it("returns null for null input", () => {
    expect(normalizeOptionalText(null)).toBeNull();
  });

  it("trims surrounding whitespace from a non-empty value", () => {
    expect(normalizeOptionalText("  A mountain range  ")).toBe("A mountain range");
  });

  it("collapses a whitespace-only string to null", () => {
    expect(normalizeOptionalText("   ")).toBeNull();
    expect(normalizeOptionalText("\t\n ")).toBeNull();
  });

  it("collapses an empty string to null", () => {
    expect(normalizeOptionalText("")).toBeNull();
  });

  it("preserves internal whitespace while trimming the edges", () => {
    expect(normalizeOptionalText("  spans the   eastern   continent  ")).toBe(
      "spans the   eastern   continent",
    );
  });

  it("returns a non-empty value unchanged when already trimmed", () => {
    expect(normalizeOptionalText("Dragon Range")).toBe("Dragon Range");
  });
});