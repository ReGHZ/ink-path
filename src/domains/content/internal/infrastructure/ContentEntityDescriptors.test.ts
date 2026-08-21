import { describe, expect, it } from "vitest";

import {
  createContentEntityDescriptors,
  type ContentEntityRepositories,
} from "./ContentEntityDescriptors.js";
import {
  CONTENT_ENTITY_TYPES,
  type ContentEntityType,
} from "../domain/support/ContentRevision.js";
import { writableAttributeFieldsOf } from "../domain/transition/attributeFieldRegistry.js";

// The compensating control decision D1 promised and item 7.6 shipped without
// (`notes/phase-7-narrative-transition.md` §3, §9). The writable-attribute
// allowlist mirrors the `fields` record of each descriptor by hand, and nothing
// in the type system can hold the two together: `fields` is keyed by plain
// `string`, so a field name in the allowlist that no descriptor knows compiles,
// passes lint, and passes every other test in the suite. It was proved at the
// 7.6 gate — adding `faction.motto` to the allowlist left all 89 files green,
// because only `character` happened to be pinned by two tests that hard-code its
// list.
//
// A phantom entry is not cosmetic drift. The header of
// `../domain/transition/attributeFieldRegistry.ts` states the stake: `field_path`
// is TEXT with no CHECK, so the allowlist is the only thing standing between
// "declare an assertion" and a write primitive for any column of any table. An
// entry that exists in the allowlist and nowhere else is exactly what 7.7's
// mutator dispatch will try to dereference.
//
// THE IMPORT DIRECTION IS THE POINT. This test lives in `infrastructure/` and
// imports the domain registry, never the reverse: the descriptor table carries
// repository dispatch, and letting `domain/transition/` reach for it would trade
// a hand-maintained list for a layering violation. Its own test is the one place
// the two may meet.
//
// Stubs return only `projectId`. `toIndexable()` reads the aggregate's other
// columns as `undefined`, which is fine here — this test compares the KEYS of
// the `fields` record, and those are literals in the descriptor, present
// whatever the values are.
function stubRepository() {
  return {
    findById: () => Promise.resolve({ projectId: "project-1" }),
  };
}

function buildDescriptors() {
  const dependencies = {
    layerRepository: stubRepository(),
    worldMapRepository: stubRepository(),
    worldElementRepository: stubRepository(),
    factionRepository: stubRepository(),
    characterRepository: stubRepository(),
    eventRepository: stubRepository(),
    plotRepository: stubRepository(),
    chapterRepository: stubRepository(),
    sceneRepository: stubRepository(),
  } as unknown as ContentEntityRepositories;

  return createContentEntityDescriptors(dependencies);
}

async function descriptorFieldsOf(
  entityType: ContentEntityType,
): Promise<readonly string[]> {
  const indexable = await buildDescriptors()[entityType].read(
    `${entityType}-1`,
  );

  if (indexable === null) {
    throw new Error(`descriptor for ${entityType} returned null`);
  }

  return Object.keys(indexable.fields).sort();
}

// The escape hatch, deliberately narrow and deliberately explicit. An embedded
// field that must NOT be narratively writable goes here, with a reason — the two
// lists answer different questions ("what does the embedding text contain" vs
// "what may a story event rewrite") and are only identical today because every
// embedded field happens to be a narrative one. Empty is the honest state now;
// filling it is a decision, and the test failing is what forces that decision to
// be made rather than skipped.
const EMBEDDED_BUT_NOT_WRITABLE: Readonly<
  Partial<Record<ContentEntityType, readonly string[]>>
> = {};

describe("ContentEntityDescriptors vs the writable attribute allowlist", () => {
  it("declares no writable field that no descriptor knows about", async () => {
    const phantoms: string[] = [];

    for (const entityType of CONTENT_ENTITY_TYPES) {
      const descriptorFields = await descriptorFieldsOf(entityType);

      for (const fieldPath of writableAttributeFieldsOf(entityType)) {
        if (!descriptorFields.includes(fieldPath)) {
          phantoms.push(`${entityType}.${fieldPath}`);
        }
      }
    }

    // Collected and asserted once so a failure names every phantom, not just
    // the first — the same reporting shape the locator test uses.
    expect(phantoms).toEqual([]);
  });

  it("leaves no descriptor field silently unclassified", async () => {
    const unclassified: string[] = [];

    for (const entityType of CONTENT_ENTITY_TYPES) {
      const writable = writableAttributeFieldsOf(entityType);
      const excluded = EMBEDDED_BUT_NOT_WRITABLE[entityType] ?? [];

      for (const fieldPath of await descriptorFieldsOf(entityType)) {
        if (!writable.includes(fieldPath) && !excluded.includes(fieldPath)) {
          unclassified.push(`${entityType}.${fieldPath}`);
        }
      }
    }

    expect(unclassified).toEqual([]);
  });

  // Guards the guard: if the stubs ever stop producing a `fields` record — a
  // descriptor rewritten to select columns narrowly, say — both tests above
  // would compare against an empty list and pass vacuously.
  it("reads a non-empty field record for every entity type", async () => {
    for (const entityType of CONTENT_ENTITY_TYPES) {
      expect(
        (await descriptorFieldsOf(entityType)).length,
      ).toBeGreaterThan(0);
    }
  });

  // The two exclusions of decision D1 are absences from the allowlist, and an
  // absence is invisible in a comparison of two lists that both lack it. Stated
  // here as a standing claim about the table itself.
  it("keeps status and the manuscript body out of both lists", async () => {
    for (const entityType of CONTENT_ENTITY_TYPES) {
      const descriptorFields = await descriptorFieldsOf(entityType);

      expect(writableAttributeFieldsOf(entityType)).not.toContain("status");
      expect(writableAttributeFieldsOf(entityType)).not.toContain("content");
      expect(descriptorFields).not.toContain("status");
      expect(descriptorFields).not.toContain("content");
    }
  });
});
