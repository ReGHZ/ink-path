import { describe, expect, it } from "vitest";

import {
  buildMediumOrLongFieldCanonicalText,
  buildShortFieldCanonicalText,
} from "./canonicalText.js";

describe("buildShortFieldCanonicalText", () => {
  it("formats entity type, name, field, and value per §14", () => {
    const text = buildShortFieldCanonicalText({
      entityType: "character",
      entityName: "Arya",
      contentField: "archetype",
      fieldValue: "The Wanderer",
    });

    expect(text).toBe(
      [
        "Entity Type: character",
        "Entity Name/Title: Arya",
        "Field: archetype",
        "Value: The Wanderer",
      ].join("\n"),
    );
  });
});

describe("buildMediumOrLongFieldCanonicalText", () => {
  it("formats entity type, name, field, revision, and body per §14", () => {
    const text = buildMediumOrLongFieldCanonicalText({
      entityType: "layer",
      entityName: "The Undercity",
      contentField: "content.backstory",
      revisionNumber: 3,
      fieldContent: "Raised by wolves in the northern woods.",
    });

    expect(text).toBe(
      [
        "Entity Type: layer",
        "Entity Name/Title: The Undercity",
        "Field: content.backstory",
        "Revision: 3",
        "",
        "Raised by wolves in the northern woods.",
      ].join("\n"),
    );
  });
});
