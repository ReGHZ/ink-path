import { describe, expect, it } from "vitest";

import {
  RELATION_TYPES,
  assertNoHierarchyPairs,
  canonicalizeEndpoints,
  directionalityOf,
  inverseLabelOf,
  isDedicatedHierarchyPair,
  isDirectional,
  isPairAllowed,
  isRelationType,
  type RelationType,
} from "./relationTypeRegistry.js";

import type { ContentEntityType } from "./ContentRevision.js";

const ALL_ENTITY_TYPES: readonly ContentEntityType[] = [
  "layer",
  "map",
  "character",
  "faction",
  "world_element",
  "event",
  "plot",
  "chapter",
  "scene",
];

// Transcribed from the frozen summary table (registry §3) rather than derived
// from the module under test — a test that asks the implementation what it
// contains cannot detect the implementation drifting from the document.
const SUMMARY_TABLE: Readonly<
  Record<RelationType, { directional: boolean; inverseLabel: string }>
> = {
  related_to: { directional: false, inverseLabel: "related_to" },
  ally_of: { directional: false, inverseLabel: "ally_of" },
  enemy_of: { directional: false, inverseLabel: "enemy_of" },
  same_location_context: {
    directional: false,
    inverseLabel: "same_location_context",
  },
  same_timeline_context: {
    directional: false,
    inverseLabel: "same_timeline_context",
  },
  member_of: { directional: true, inverseLabel: "has_member" },
  participates_in: { directional: true, inverseLabel: "has_participant" },
  appears_in: { directional: true, inverseLabel: "features" },
  depicts: { directional: true, inverseLabel: "depicted_by" },
  located_in: { directional: true, inverseLabel: "contains_semantically" },
  causes: { directional: true, inverseLabel: "caused_by" },
  influences: { directional: true, inverseLabel: "influenced_by" },
  supports: { directional: true, inverseLabel: "supported_by" },
  opposes: { directional: true, inverseLabel: "opposed_by" },
  betrays: { directional: true, inverseLabel: "betrayed_by" },
  foreshadows: { directional: true, inverseLabel: "foreshadowed_by" },
  resolves: { directional: true, inverseLabel: "resolved_by" },
};

// The pair matrix, transcribed ONE-WAY from the frozen document (registry §1
// and §2) in the same grouping the document uses: one line per source, targets
// in the document's order. This is the substance of the registry — locking only
// directionality and inverse labels would leave ~200 pairs verified by nothing
// but spot checks, and a dropped or invented pair would keep the suite green.
//
// Maintenance rule: update this table from the DOCUMENT, never from
// `relationTypeRegistry.ts`. Copying the module's own fan-out lists would make
// the two agree by construction and detect nothing. Symmetry for
// non-directional types is expanded below from SUMMARY_TABLE — the test's own
// knowledge, not the module's.
const DOCUMENT_PAIR_MATRIX: Readonly<
  Record<RelationType, ReadonlyArray<readonly [ContentEntityType, string]>>
> = {
  related_to: [
    [
      "character",
      "character faction world_element event plot chapter map layer scene",
    ],
    ["faction", "faction world_element event plot chapter map layer scene"],
    ["world_element", "world_element event plot chapter map layer scene"],
    ["event", "event plot chapter map layer scene"],
    ["plot", "plot chapter map layer scene"],
    ["chapter", "chapter map layer"],
    ["map", "layer"],
    ["scene", "scene map layer"],
  ],
  ally_of: [
    ["character", "character faction"],
    ["faction", "faction"],
  ],
  enemy_of: [
    ["character", "character faction"],
    ["faction", "faction"],
  ],
  same_location_context: [
    ["character", "character faction world_element event plot chapter scene"],
    ["faction", "faction world_element event plot chapter scene"],
    ["world_element", "world_element event plot chapter scene"],
    ["event", "event plot chapter scene"],
    ["plot", "plot chapter scene"],
    ["chapter", "chapter"],
    ["scene", "scene"],
  ],
  same_timeline_context: [
    ["character", "character faction world_element event plot chapter scene"],
    ["faction", "faction world_element event plot chapter scene"],
    ["world_element", "world_element event plot chapter scene"],
    ["event", "event plot chapter scene"],
    ["plot", "plot chapter scene"],
    ["chapter", "chapter"],
    ["scene", "scene"],
  ],
  member_of: [
    ["character", "faction"],
    ["faction", "faction"],
  ],
  participates_in: [
    ["character", "event"],
    ["faction", "event"],
    ["world_element", "event"],
  ],
  appears_in: [
    ["character", "chapter plot scene"],
    ["faction", "chapter plot scene"],
    ["world_element", "chapter plot scene"],
    ["event", "chapter plot"],
  ],
  depicts: [["scene", "event"]],
  located_in: [
    ["character", "map layer"],
    ["faction", "map layer"],
    ["world_element", "map layer"],
    ["event", "map layer"],
    ["scene", "map layer"],
  ],
  causes: [
    ["event", "event plot"],
    ["character", "event"],
    ["faction", "event"],
  ],
  influences: [
    ["character", "character faction event plot chapter"],
    ["faction", "character faction event plot chapter"],
    ["world_element", "character faction event plot chapter"],
    ["event", "character faction event plot chapter"],
    ["plot", "character faction event plot chapter"],
  ],
  supports: [
    ["character", "character faction event plot"],
    ["faction", "character faction event plot"],
  ],
  opposes: [
    ["character", "character faction event plot"],
    ["faction", "character faction event plot"],
  ],
  betrays: [
    ["character", "character faction"],
    ["faction", "character faction"],
  ],
  foreshadows: [
    ["world_element", "event plot chapter"],
    ["event", "event plot chapter"],
    ["plot", "event plot chapter"],
    ["chapter", "event plot chapter"],
    ["scene", "event plot scene"],
  ],
  resolves: [
    ["event", "event plot"],
    ["plot", "event plot"],
    ["chapter", "event plot"],
    ["scene", "event plot"],
  ],
};

function expectedPairKeys(relationType: RelationType): ReadonlySet<string> {
  const keys = new Set<string>();

  for (const [source, targets] of DOCUMENT_PAIR_MATRIX[relationType]) {
    for (const target of targets.split(" ")) {
      keys.add(`${source}->${target}`);

      if (!SUMMARY_TABLE[relationType].directional) {
        keys.add(`${target}->${source}`);
      }
    }
  }

  return keys;
}

function endpoint(entityType: ContentEntityType, entityId: string) {
  return { entityType, entityId };
}

describe("relationTypeRegistry — catalogue", () => {
  it("holds exactly the 17 frozen relation types", () => {
    expect(RELATION_TYPES).toHaveLength(17);
    expect([...RELATION_TYPES].sort()).toEqual(
      Object.keys(SUMMARY_TABLE).sort(),
    );
  });

  it("splits 5 non-directional and 12 directional (registry §6 Phase Boundary)", () => {
    const directional = RELATION_TYPES.filter(isDirectional);

    expect(directional).toHaveLength(12);
    expect(RELATION_TYPES.length - directional.length).toBe(5);
  });

  it.each(RELATION_TYPES)(
    "%s matches the summary table on directionality and inverse label",
    (relationType) => {
      const expected = SUMMARY_TABLE[relationType];

      expect(directionalityOf(relationType)).toBe(
        expected.directional ? "directional" : "non_directional",
      );
      expect(inverseLabelOf(relationType)).toBe(expected.inverseLabel);
    },
  );

  it("rejects strings outside the registry (Rule 1)", () => {
    expect(isRelationType("has_member")).toBe(false);
    expect(isRelationType("caused_by")).toBe(false);
    expect(isRelationType("depicted_by")).toBe(false);
    expect(isRelationType("")).toBe(false);
    expect(isRelationType("RELATED_TO")).toBe(false);
  });

  it("accepts every registered type", () => {
    for (const relationType of RELATION_TYPES) {
      expect(isRelationType(relationType)).toBe(true);
    }
  });
});

describe("relationTypeRegistry — pair matrix locked to the frozen document", () => {
  // 17 types × 9 × 9 = 1377 combinations asserted for EQUALITY, not just for
  // the positives. Every "Excluded" line the document writes is therefore
  // locked too, without needing its own test: a pair that is invented, dropped,
  // or silently made symmetric shows up here. Mismatches are collected instead
  // of asserted one by one so a failure names every offending pair at once.
  it.each(RELATION_TYPES)(
    "%s allows exactly the pairs the document lists, and nothing else",
    (relationType) => {
      const expected = expectedPairKeys(relationType);
      const mismatches: string[] = [];

      for (const source of ALL_ENTITY_TYPES) {
        for (const target of ALL_ENTITY_TYPES) {
          const allowed = isPairAllowed(relationType, source, target);
          const shouldAllow = expected.has(`${source}->${target}`);

          if (allowed !== shouldAllow) {
            mismatches.push(
              `${source} -> ${target}: document says ${shouldAllow}, registry says ${allowed}`,
            );
          }
        }
      }

      expect(mismatches).toEqual([]);
    },
  );

  it("covers every entity type pair for every relation type", () => {
    expect(RELATION_TYPES.length * ALL_ENTITY_TYPES.length ** 2).toBe(1377);
  });
});

describe("relationTypeRegistry — directionality of the pair matrix", () => {
  it("treats non-directional pairs as symmetric even though the matrix is written one-way", () => {
    expect(isPairAllowed("related_to", "character", "faction")).toBe(true);
    expect(isPairAllowed("related_to", "faction", "character")).toBe(true);

    expect(isPairAllowed("ally_of", "character", "faction")).toBe(true);
    expect(isPairAllowed("ally_of", "faction", "character")).toBe(true);
  });

  it("does not swap directional pairs (Rule 10)", () => {
    expect(isPairAllowed("member_of", "character", "faction")).toBe(true);
    expect(isPairAllowed("member_of", "faction", "character")).toBe(false);

    expect(isPairAllowed("located_in", "character", "map")).toBe(true);
    expect(isPairAllowed("located_in", "map", "character")).toBe(false);
  });

  it("keeps map and layer out of the two context types", () => {
    for (const relationType of [
      "same_location_context",
      "same_timeline_context",
    ] as const) {
      for (const entityType of ["map", "layer"] as const) {
        expect(isPairAllowed(relationType, "character", entityType)).toBe(
          false,
        );
        expect(isPairAllowed(relationType, entityType, "character")).toBe(
          false,
        );
      }
    }
  });

  it("keeps chapter out of `influences` as a source (narrative container, not a cause)", () => {
    expect(isPairAllowed("influences", "plot", "chapter")).toBe(true);
    expect(isPairAllowed("influences", "chapter", "plot")).toBe(false);
  });
});

describe("relationTypeRegistry — dedicated hierarchy (Rule 11, §5, §7.3)", () => {
  it("recognises the three hierarchy pairs in either order", () => {
    expect(isDedicatedHierarchyPair("layer", "layer")).toBe(true);
    expect(isDedicatedHierarchyPair("map", "map")).toBe(true);
    expect(isDedicatedHierarchyPair("chapter", "scene")).toBe(true);
    expect(isDedicatedHierarchyPair("scene", "chapter")).toBe(true);
  });

  it("does not mistake other same-type pairs for hierarchy", () => {
    expect(isDedicatedHierarchyPair("character", "character")).toBe(false);
    expect(isDedicatedHierarchyPair("scene", "scene")).toBe(false);
    expect(isDedicatedHierarchyPair("chapter", "chapter")).toBe(false);
  });

  // The cross-type sweep is the point: a per-type spot check would pass even if
  // a future edit reopened hierarchy through a single relation type.
  it("allows no hierarchy pair through ANY relation type", () => {
    for (const relationType of RELATION_TYPES) {
      for (const [first, second] of [
        ["layer", "layer"],
        ["map", "map"],
        ["chapter", "scene"],
        ["scene", "chapter"],
      ] as const) {
        expect(isPairAllowed(relationType, first, second)).toBe(false);
      }
    }
  });

  // The module-load guard is what keeps the sweep above true for matrices that
  // do not exist yet. Proving it fires needs a bad matrix, which the frozen
  // constant will never contain — hence the guard takes its input as an
  // argument.
  it("rejects a matrix that smuggles hierarchy in, naming the offending pair", () => {
    expect(() => {
      assertNoHierarchyPairs("related_to", [["scene", "chapter"]]);
    }).toThrow(/scene\/chapter/);

    expect(() => {
      assertNoHierarchyPairs("related_to", [["map", "map"]]);
    }).toThrow(/content_relationships/);
  });

  it("passes a matrix that only contains legitimate pairs", () => {
    expect(() => {
      assertNoHierarchyPairs("related_to", [
        ["scene", "scene"],
        ["chapter", "chapter"],
        ["map", "layer"],
      ]);
    }).not.toThrow();
  });
});

describe("relationTypeRegistry — scene (addendum 2026-08-14)", () => {
  it("puts scene on the receiving end of appears_in", () => {
    for (const source of ["character", "faction", "world_element"] as const) {
      expect(isPairAllowed("appears_in", source, "scene")).toBe(true);
      expect(isPairAllowed("appears_in", "scene", source)).toBe(false);
    }
  });

  it("routes scene↔event exclusively through depicts (§7.2)", () => {
    expect(isPairAllowed("depicts", "scene", "event")).toBe(true);
    expect(isPairAllowed("depicts", "event", "scene")).toBe(false);
    expect(isPairAllowed("appears_in", "event", "scene")).toBe(false);
  });

  it("gives depicts exactly one legal pair", () => {
    for (const source of ALL_ENTITY_TYPES) {
      for (const target of ALL_ENTITY_TYPES) {
        const expected = source === "scene" && target === "event";

        expect(isPairAllowed("depicts", source, target)).toBe(expected);
      }
    }
  });

  it("lets a scene state its location, and be a narrative source", () => {
    expect(isPairAllowed("located_in", "scene", "map")).toBe(true);
    expect(isPairAllowed("located_in", "scene", "layer")).toBe(true);

    expect(isPairAllowed("foreshadows", "scene", "event")).toBe(true);
    expect(isPairAllowed("foreshadows", "scene", "plot")).toBe(true);
    expect(isPairAllowed("foreshadows", "scene", "scene")).toBe(true);
    expect(isPairAllowed("resolves", "scene", "event")).toBe(true);
    expect(isPairAllowed("resolves", "scene", "plot")).toBe(true);
  });

  // §7.1: scene is a unit of telling, so it has neither agency nor the standing
  // of an in-world happening. Its absence from these nine types is the whole
  // derivation, on both sides of the pair.
  it.each([
    "causes",
    "influences",
    "supports",
    "opposes",
    "betrays",
    "member_of",
    "participates_in",
    "ally_of",
    "enemy_of",
  ] as const)("never admits scene into %s, on either side", (relationType) => {
    for (const other of ALL_ENTITY_TYPES) {
      expect(isPairAllowed(relationType, "scene", other)).toBe(false);
      expect(isPairAllowed(relationType, other, "scene")).toBe(false);
    }
  });

  it("still allows the loose context types to mention scene↔event", () => {
    for (const relationType of [
      "related_to",
      "same_location_context",
      "same_timeline_context",
    ] as const) {
      expect(isPairAllowed(relationType, "scene", "event")).toBe(true);
      expect(isPairAllowed(relationType, "event", "scene")).toBe(true);
    }
  });
});

describe("relationTypeRegistry — canonicalisation (§7.4)", () => {
  const character = endpoint("character", "c-1");
  const faction = endpoint("faction", "f-1");

  it("orders a non-directional pair by entity type, whichever way it arrives", () => {
    const fromLeft = canonicalizeEndpoints("related_to", character, faction);
    const fromRight = canonicalizeEndpoints("related_to", faction, character);

    expect(fromLeft).toEqual({ source: character, target: faction });
    expect(fromRight).toEqual(fromLeft);
  });

  it("falls back to entity id only when the entity types match", () => {
    const younger = endpoint("character", "c-2");

    expect(canonicalizeEndpoints("ally_of", younger, character)).toEqual({
      source: character,
      target: younger,
    });
    expect(canonicalizeEndpoints("ally_of", character, younger)).toEqual({
      source: character,
      target: younger,
    });
  });

  it("is idempotent", () => {
    const once = canonicalizeEndpoints("related_to", faction, character);
    const twice = canonicalizeEndpoints("related_to", once.source, once.target);

    expect(twice).toEqual(once);
  });

  it("leaves directional pairs exactly as given (Rule 10)", () => {
    const event = endpoint("event", "e-1");

    expect(
      canonicalizeEndpoints("causes", event, endpoint("plot", "p-1")),
    ).toEqual({ source: event, target: endpoint("plot", "p-1") });
    expect(canonicalizeEndpoints("influences", faction, character)).toEqual({
      source: faction,
      target: character,
    });
    expect(canonicalizeEndpoints("influences", character, faction)).toEqual({
      source: character,
      target: faction,
    });
  });

  // The stored ContentEntityType values are what the rule compares — the route
  // segments (`/world-maps`) sort differently and would produce a different
  // canonical row than the frozen document describes.
  it("compares stored entity type values, where map sorts before scene", () => {
    const map = endpoint("map", "m-1");
    const scene = endpoint("scene", "s-1");

    expect(canonicalizeEndpoints("related_to", scene, map)).toEqual({
      source: map,
      target: scene,
    });
  });
});
