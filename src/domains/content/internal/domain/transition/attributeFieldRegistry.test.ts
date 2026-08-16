import { describe, expect, it } from "vitest";

import {
  domainAttributeFieldOf,
  isWritableAttributeField,
  writableAttributeFieldsOf,
} from "./attributeFieldRegistry.js";
import {
  CONTENT_ENTITY_TYPES,
  type ContentEntityType,
} from "../support/ContentRevision.js";

// One field per type that must be writable, chosen as the one a narrative
// consequence would plausibly touch. Kept as a literal table rather than derived
// from the registry: a test that reads its subject to build its expectations
// passes no matter what the subject says.
const writableSample: Readonly<Record<ContentEntityType, string>> = {
  layer: "exposure",
  map: "terrain",
  world_element: "description",
  faction: "ideology",
  character: "archetype",
  event: "significance",
  plot: "conflict",
  chapter: "summary",
  scene: "summary",
};

describe("attributeFieldRegistry", () => {
  it("declares writable fields for every content entity type", () => {
    for (const entityType of CONTENT_ENTITY_TYPES) {
      expect(writableAttributeFieldsOf(entityType).length).toBeGreaterThan(0);
    }
  });

  it("accepts the narratively meaningful field of each entity type", () => {
    for (const entityType of CONTENT_ENTITY_TYPES) {
      expect(
        isWritableAttributeField(entityType, writableSample[entityType]),
      ).toBe(true);
    }
  });

  // The whole reason the allowlist exists rather than being "any column".
  it("rejects status for every entity type", () => {
    for (const entityType of CONTENT_ENTITY_TYPES) {
      expect(isWritableAttributeField(entityType, "status")).toBe(false);
      expect(domainAttributeFieldOf(entityType, "status")).toBeNull();
    }
  });

  it("rejects content for every entity type", () => {
    for (const entityType of CONTENT_ENTITY_TYPES) {
      expect(isWritableAttributeField(entityType, "content")).toBe(false);
    }
  });

  // Structural columns that exist on the aggregates but are not narrative facts:
  // ordering, hierarchy pointers and identity.
  it.each([
    ["chapter", "order"],
    ["scene", "orderInChapter"],
    ["scene", "chapterId"],
    ["layer", "level"],
    ["event", "timelineOrder"],
    ["character", "id"],
    ["character", "version"],
    ["character", "projectId"],
    ["character", "currentRevisionId"],
  ] as const)("rejects %s.%s", (entityType, fieldPath) => {
    expect(isWritableAttributeField(entityType, fieldPath)).toBe(false);
  });

  it("rejects a field that belongs to a different entity type", () => {
    expect(isWritableAttributeField("chapter", "archetype")).toBe(false);
    expect(isWritableAttributeField("character", "summary")).toBe(false);
  });

  it("does not treat inherited object properties as writable fields", () => {
    expect(isWritableAttributeField("character", "toString")).toBe(false);
    expect(isWritableAttributeField("character", "constructor")).toBe(false);
  });

  // The one place a wire name and a domain property name differ. If a future
  // field breaks this pattern, the loop below is what forces the mapping to be
  // written down instead of guessed at the call site.
  it("maps event.event_type to the aggregate property eventType", () => {
    expect(domainAttributeFieldOf("event", "event_type")).toBe("eventType");
  });

  it("does not accept the domain property name in place of the wire name", () => {
    expect(isWritableAttributeField("event", "eventType")).toBe(false);
  });

  it("maps every other writable field to its identical domain name", () => {
    for (const entityType of CONTENT_ENTITY_TYPES) {
      for (const fieldPath of writableAttributeFieldsOf(entityType)) {
        if (entityType === "event" && fieldPath === "event_type") {
          continue;
        }

        expect(domainAttributeFieldOf(entityType, fieldPath)).toBe(fieldPath);
      }
    }
  });

  it("returns null rather than the field path for a field it does not allow", () => {
    expect(domainAttributeFieldOf("character", "status")).toBeNull();
    expect(domainAttributeFieldOf("character", "unknown_field")).toBeNull();
  });

  it("lists writable fields in a stable sorted order", () => {
    const fields = writableAttributeFieldsOf("character");

    expect(fields).toEqual([...fields].sort());
    expect(fields).toEqual([
      "archetype",
      "background",
      "description",
      "goal",
      "name",
      "personality",
    ]);
  });
});
