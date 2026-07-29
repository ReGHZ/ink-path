import { describe, expect, it } from "vitest";

import {
  buildLogicalContentField,
  normalizeContentFieldHeading,
} from "./contentFieldNormalization.js";

describe("normalizeContentFieldHeading", () => {
  it("lowercases and trims a plain heading", () => {
    expect(normalizeContentFieldHeading("  Backstory  ")).toBe("backstory");
  });

  it("strips a trailing colon", () => {
    expect(normalizeContentFieldHeading("Backstory:")).toBe("backstory");
  });

  it("strips leading markdown heading markers", () => {
    expect(normalizeContentFieldHeading("## Fears")).toBe("fears");
    expect(normalizeContentFieldHeading("# Notes")).toBe("notes");
  });

  it("collapses internal whitespace to a single underscore", () => {
    expect(normalizeContentFieldHeading("Relationships Note")).toBe(
      "relationships_note",
    );
  });

  it("is stable across repeated normalization (idempotent)", () => {
    const once = normalizeContentFieldHeading("## Timeline Note:");
    const twice = normalizeContentFieldHeading(once);

    expect(twice).toBe(once);
  });

  it("normalizes equivalent headings to the same value", () => {
    expect(normalizeContentFieldHeading("Backstory:")).toBe(
      normalizeContentFieldHeading("  backstory  "),
    );
  });
});

describe("buildLogicalContentField", () => {
  it("prefixes the normalized heading with content.", () => {
    expect(buildLogicalContentField("Backstory:")).toBe("content.backstory");
  });
});
