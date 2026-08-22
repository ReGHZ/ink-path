import { describe, expect, it } from "vitest";

import {
  canonicalizeEndpoints,
  draftRelationshipDefinition,
  symbolFromLabel,
  isDedicatedHierarchyPair,
  isPairAllowedBy,
} from "./relationshipDefinition.js";
import {
  RELATIONSHIP_DEFINITION_SEED,
  seededDefinition,
} from "./relationshipDefinitionSeed.js";

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
type MatrixPredicate =
  | "related_to"
  | "ally_of"
  | "enemy_of"
  | "same_location_context"
  | "same_timeline_context"
  | "member_of"
  | "participates_in"
  | "appears_in"
  | "depicts"
  | "located_in"
  | "causes"
  | "influences"
  | "supports"
  | "opposes"
  | "betrays"
  | "foreshadows"
  | "resolves";

const SUMMARY_TABLE: Readonly<
  Record<MatrixPredicate, { directional: boolean; inverseLabel: string }>
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
// the seed module. Copying its own fan-out lists would make
// the two agree by construction and detect nothing. Symmetry for
// non-directional types is expanded below from SUMMARY_TABLE — the test's own
// knowledge, not the module's.
const DOCUMENT_PAIR_MATRIX: Readonly<
  Record<MatrixPredicate, ReadonlyArray<readonly [ContentEntityType, string]>>
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

const MATRIX_PREDICATES = Object.keys(SUMMARY_TABLE) as MatrixPredicate[];

// The seeded rows are what the frozen matrix became. Reading them through the
// same accessor production uses keeps this suite locking the DATA the seeder
// writes, not a constant that no longer exists.
function definitionOf(predicate: MatrixPredicate) {
  return seededDefinition(predicate);
}

function isPairAllowed(
  predicate: MatrixPredicate,
  source: ContentEntityType,
  target: ContentEntityType,
): boolean {
  return isPairAllowedBy(definitionOf(predicate), source, target);
}

function expectedPairKeys(relationType: MatrixPredicate): ReadonlySet<string> {
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

describe("relationship definitions — catalogue", () => {
  it("holds exactly the 17 frozen relation types", () => {
    expect(MATRIX_PREDICATES).toHaveLength(17);
    // Every matrix predicate is present in the seed, and the seed adds exactly
    // the two the 2026-08-17 addendum names — nothing else may appear without
    // this failing.
    expect(RELATIONSHIP_DEFINITION_SEED.map((seed) => seed.predicate).sort()).toEqual(
      [...MATRIX_PREDICATES, "owns", "rules"].sort(),
    );
  });

  it("splits 5 non-directional and 12 directional (registry §6 Phase Boundary)", () => {
    const directional = MATRIX_PREDICATES.filter(
      (predicate) => definitionOf(predicate).directionality === "directional",
    );

    expect(directional).toHaveLength(12);
    expect(MATRIX_PREDICATES.length - directional.length).toBe(5);
  });

  it.each(MATRIX_PREDICATES)(
    "%s matches the summary table on directionality and inverse label",
    (relationType) => {
      const expected = SUMMARY_TABLE[relationType];

      expect(definitionOf(relationType).directionality).toBe(
        expected.directional ? "directional" : "non_directional",
      );
      expect(definitionOf(relationType).inverseLabel).toBe(
        expected.inverseLabel,
      );
    },
  );

  // Inverse labels are SYMBOLS, never predicates: seeding `has_member` as a row
  // would make the same fact storable twice, once per direction.
  it("seeds no inverse label as a predicate of its own", () => {
    const predicates = new Set(
      RELATIONSHIP_DEFINITION_SEED.map((seed) => seed.predicate),
    );

    for (const { inverseLabel, directional } of Object.values(SUMMARY_TABLE)) {
      if (directional) {
        expect(predicates.has(inverseLabel)).toBe(false);
      }
    }
  });
});

describe("relationship definitions — pair matrix locked to the frozen document", () => {
  // 17 types × 9 × 9 = 1377 combinations asserted for EQUALITY, not just for
  // the positives. Every "Excluded" line the document writes is therefore
  // locked too, without needing its own test: a pair that is invented, dropped,
  // or silently made symmetric shows up here. Mismatches are collected instead
  // of asserted one by one so a failure names every offending pair at once.
  it.each(MATRIX_PREDICATES)(
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
              `${source} -> ${target}: document says ${shouldAllow}, seed says ${allowed}`,
            );
          }
        }
      }

      expect(mismatches).toEqual([]);
    },
  );

  it("covers every entity type pair for every relation type", () => {
    expect(MATRIX_PREDICATES.length * ALL_ENTITY_TYPES.length ** 2).toBe(1377);
  });
});

describe("relationship definitions — directionality of the pair matrix", () => {
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

describe("relationship definitions — dedicated hierarchy (Rule 11, §5, §7.3)", () => {
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
    for (const relationType of MATRIX_PREDICATES) {
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

  // What used to be a module-load guard over a constant. The constant is gone,
  // so the assertion moved to the DATA the seeder writes — and the database
  // holds the same rule for every row an author adds later
  // (`relationship_definition_signatures_no_dedicated_hierarchy`).
  it("seeds no signature that is a dedicated hierarchy pair", () => {
    const offenders: string[] = [];

    for (const seed of RELATIONSHIP_DEFINITION_SEED) {
      for (const signature of seed.signatures) {
        if (
          signature.objectEntityType !== null &&
          isDedicatedHierarchyPair(
            signature.subjectEntityType,
            signature.objectEntityType,
          )
        ) {
          offenders.push(
            `${seed.predicate}: ${signature.subjectEntityType} -> ${signature.objectEntityType}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("relationship definitions — scene (addendum 2026-08-14)", () => {
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

describe("relationship definitions — canonicalisation (§7.4)", () => {
  const character = endpoint("character", "c-1");
  const faction = endpoint("faction", "f-1");

  it("orders a non-directional pair by entity type, whichever way it arrives", () => {
    const fromLeft = canonicalizeEndpoints("non_directional", character, faction);
    const fromRight = canonicalizeEndpoints("non_directional", faction, character);

    expect(fromLeft).toEqual({ source: character, target: faction });
    expect(fromRight).toEqual(fromLeft);
  });

  it("falls back to entity id only when the entity types match", () => {
    const younger = endpoint("character", "c-2");

    expect(canonicalizeEndpoints("non_directional", younger, character)).toEqual({
      source: character,
      target: younger,
    });
    expect(canonicalizeEndpoints("non_directional", character, younger)).toEqual({
      source: character,
      target: younger,
    });
  });

  it("is idempotent", () => {
    const once = canonicalizeEndpoints("non_directional", faction, character);
    const twice = canonicalizeEndpoints("non_directional", once.source, once.target);

    expect(twice).toEqual(once);
  });

  it("leaves directional pairs exactly as given (Rule 10)", () => {
    const event = endpoint("event", "e-1");

    expect(
      canonicalizeEndpoints("directional", event, endpoint("plot", "p-1")),
    ).toEqual({ source: event, target: endpoint("plot", "p-1") });
    expect(canonicalizeEndpoints("directional", faction, character)).toEqual({
      source: faction,
      target: character,
    });
    expect(canonicalizeEndpoints("directional", character, faction)).toEqual({
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

    expect(canonicalizeEndpoints("non_directional", scene, map)).toEqual({
      source: map,
      target: scene,
    });
  });
});

describe("draftRelationshipDefinition", () => {
  const binary = {
    predicate: "mentors",
    directionality: "directional" as const,
    objectRequired: true,
    inverseLabel: "mentored_by",
    displayLabel: "mentors",
    inverseDisplayLabel: "mentored by",
    signatures: [
      {
        subjectEntityType: "character" as ContentEntityType,
        objectEntityType: "character" as ContentEntityType,
      },
    ],
  };

  it("accepts a binary predicate and trims what the author typed", () => {
    const draft = draftRelationshipDefinition({
      ...binary,
      predicate: "  mentors  ",
      inverseLabel: "  mentored_by  ",
      displayLabel: "  mentors  ",
      inverseDisplayLabel: "  mentored by  ",
    });

    expect(draft.predicate).toBe("mentors");
    expect(draft.inverseLabel).toBe("mentored_by");
    expect(draft.displayLabel).toBe("mentors");
    expect(draft.inverseDisplayLabel).toBe("mentored by");
    expect(draft.signatures).toEqual(binary.signatures);
  });

  it("accepts a unary predicate — the kind the rule engine's canonical example needs", () => {
    const draft = draftRelationshipDefinition({
      predicate: "dead",
      directionality: "directional",
      objectRequired: false,
      inverseLabel: "dead",
      displayLabel: "mati",
      inverseDisplayLabel: "mati",
      signatures: [
        { subjectEntityType: "character", objectEntityType: null },
      ],
    });

    expect(draft.objectRequired).toBe(false);
    expect(draft.signatures[0]?.objectEntityType).toBeNull();
  });

  it.each([
    ["Mentors", "capital"],
    ["9lives", "leading digit"],
    ["mentors-of", "hyphen"],
    ["mentors of", "space"],
    ["", "empty"],
  ])("refuses the predicate name %s (%s)", (predicate) => {
    expect(() =>
      draftRelationshipDefinition({ ...binary, predicate }),
    ).toThrow(/lower snake_case/);
  });

  it("refuses a blank inverse label instead of inventing one", () => {
    expect(() =>
      draftRelationshipDefinition({ ...binary, inverseLabel: "   " }),
    ).toThrow(/inverse label/);
  });

  it("refuses a definition with no signature", () => {
    expect(() =>
      draftRelationshipDefinition({ ...binary, signatures: [] }),
    ).toThrow(/at least one signature/);
  });

  it("refuses an object-less signature on a predicate that takes an object", () => {
    expect(() =>
      draftRelationshipDefinition({
        ...binary,
        signatures: [
          { subjectEntityType: "character", objectEntityType: null },
        ],
      }),
    ).toThrow(/every signature needs one/);
  });

  it("refuses an object on a predicate that takes none", () => {
    expect(() =>
      draftRelationshipDefinition({
        ...binary,
        objectRequired: false,
        signatures: [
          { subjectEntityType: "character", objectEntityType: "faction" },
        ],
      }),
    ).toThrow(/no signature may name one/);
  });

  it.each([
    ["layer", "layer"],
    ["map", "map"],
    ["chapter", "scene"],
    ["scene", "chapter"],
  ])(
    "refuses the structural hierarchy pair %s/%s at DEFINE time, not only at assert time",
    (subjectEntityType, objectEntityType) => {
      expect(() =>
        draftRelationshipDefinition({
          ...binary,
          signatures: [
            {
              subjectEntityType: subjectEntityType as ContentEntityType,
              objectEntityType: objectEntityType as ContentEntityType,
            },
          ],
        }),
      ).toThrow(/structural hierarchy/);
    },
  );

  it("refuses the same signature twice", () => {
    expect(() =>
      draftRelationshipDefinition({
        ...binary,
        signatures: [
          { subjectEntityType: "character", objectEntityType: "faction" },
          { subjectEntityType: "character", objectEntityType: "faction" },
        ],
      }),
    ).toThrow(/declared twice/);
  });

  it("refuses the mirror of a non-directional signature — one meaning, one row", () => {
    expect(() =>
      draftRelationshipDefinition({
        ...binary,
        directionality: "non_directional",
        signatures: [
          { subjectEntityType: "character", objectEntityType: "faction" },
          { subjectEntityType: "faction", objectEntityType: "character" },
        ],
      }),
    ).toThrow(/already covered by its mirror/);
  });

  it("KEEPS both directions when the predicate IS directional", () => {
    const draft = draftRelationshipDefinition({
      ...binary,
      signatures: [
        { subjectEntityType: "character", objectEntityType: "faction" },
        { subjectEntityType: "faction", objectEntityType: "character" },
      ],
    });

    expect(draft.signatures).toHaveLength(2);
  });
});

describe("symbolFromLabel", () => {
  it.each([
    ["mentors", "mentors"],
    ["Mentors", "mentors"],
    ["menikah dengan", "menikah_dengan"],
    ["  member   of  ", "member_of"],
    ["ally-of", "ally_of"],
    ["café patron", "cafe_patron"],
    ["Zoë's ally", "zoe_s_ally"],
  ])("derives %s into the symbol %s", (label, expected) => {
    expect(symbolFromLabel(label)).toBe(expected);
  });

  it.each([
    ["結婚", "Japanese"],
    ["الزواج", "Arabic"],
    ["брак", "Cyrillic"],
    ["結婚 の 相手", "Japanese with spaces"],
    ["   ", "blank"],
    ["1st_wife", "leading digit"],
  ])(
    "returns null for %s (%s) instead of refusing the author's word",
    (label) => {
      expect(symbolFromLabel(label)).toBeNull();
    },
  );

  it("never returns a symbol the database CHECK would reject", () => {
    const labels = [
      "mentors",
      "menikah dengan",
      "café patron",
      "A  B",
      "__x__",
      "x1",
    ];

    for (const label of labels) {
      const symbol = symbolFromLabel(label);

      if (symbol !== null) {
        expect(symbol).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });
});

describe("draftRelationshipDefinition — display text", () => {
  const base = {
    predicate: "mentors",
    directionality: "directional" as const,
    objectRequired: true,
    inverseLabel: "mentored_by",
    displayLabel: "mentors",
    inverseDisplayLabel: "mentored by",
    signatures: [
      {
        subjectEntityType: "character" as ContentEntityType,
        objectEntityType: "character" as ContentEntityType,
      },
    ],
  };

  it.each([
    ["結婚", "した相手"],
    ["брак", "супруг"],
    ["menikah dengan", "pasangan dari"],
  ])(
    "accepts display text in any script (%s / %s) — the symbol stays ASCII",
    (displayLabel, inverseDisplayLabel) => {
      const draft = draftRelationshipDefinition({
        ...base,
        displayLabel,
        inverseDisplayLabel,
      });

      expect(draft.displayLabel).toBe(displayLabel);
      expect(draft.inverseDisplayLabel).toBe(inverseDisplayLabel);
      expect(draft.predicate).toBe("mentors");
    },
  );

  it.each([
    ["displayLabel", "display label"],
    ["inverseDisplayLabel", "inverse display label"],
  ])("refuses a blank %s", (field, message) => {
    expect(() =>
      draftRelationshipDefinition({ ...base, [field]: "   " }),
    ).toThrow(new RegExp(message));
  });
});

describe("symbolFromLabel — the generated-symbol namespace is reserved", () => {
  it.each(["p_1a2b3c4d", "p_0", "p_abcdefabcdef"])(
    "refuses to derive %s from a label, so a generated symbol cannot be taken",
    (label) => {
      expect(symbolFromLabel(label)).toBeNull();
    },
  );

  it("still derives labels that merely START with p", () => {
    expect(symbolFromLabel("patron of")).toBe("patron_of");
    expect(symbolFromLabel("p_zzz")).toBe("p_zzz");
  });

  it("collapses punctuation, so two labels CAN share one symbol — a real conflict", () => {
    expect(symbolFromLabel("mati (fisik)")).toBe(symbolFromLabel("mati fisik"));
  });
});
