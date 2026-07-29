import { describe, expect, it } from "vitest";

import { buildPointKey, derivePointId } from "./pointId.js";

const BASE_PARTS = {
  projectId: "11111111-1111-1111-1111-111111111111",
  entityType: "layer",
  entityId: "22222222-2222-2222-2222-222222222222",
  contentField: "description",
  revisionId: "33333333-3333-3333-3333-333333333333",
  chunkIndex: 0,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("buildPointKey", () => {
  it("joins every part with a colon in canonical order", () => {
    expect(buildPointKey(BASE_PARTS)).toBe(
      "11111111-1111-1111-1111-111111111111:layer:22222222-2222-2222-2222-222222222222:description:33333333-3333-3333-3333-333333333333:0",
    );
  });
});

describe("derivePointId", () => {
  it("is deterministic — same canonical key always yields the same id", () => {
    const key = buildPointKey(BASE_PARTS);

    expect(derivePointId(key)).toBe(derivePointId(key));
  });

  it("produces a valid UUID string, which is a format Qdrant accepts as a point id", () => {
    const id = derivePointId(buildPointKey(BASE_PARTS));

    expect(id).toMatch(UUID_PATTERN);
  });

  it("produces different ids for different chunk indexes of the same field", () => {
    const first = derivePointId(buildPointKey({ ...BASE_PARTS, chunkIndex: 0 }));
    const second = derivePointId(buildPointKey({ ...BASE_PARTS, chunkIndex: 1 }));

    expect(first).not.toBe(second);
  });

  it("produces different ids for different revisions of the same field", () => {
    const first = derivePointId(buildPointKey(BASE_PARTS));
    const second = derivePointId(
      buildPointKey({
        ...BASE_PARTS,
        revisionId: "44444444-4444-4444-4444-444444444444",
      }),
    );

    expect(first).not.toBe(second);
  });

  it("produces different ids for different content fields", () => {
    const first = derivePointId(buildPointKey(BASE_PARTS));
    const second = derivePointId(
      buildPointKey({ ...BASE_PARTS, contentField: "content.backstory" }),
    );

    expect(first).not.toBe(second);
  });
});
