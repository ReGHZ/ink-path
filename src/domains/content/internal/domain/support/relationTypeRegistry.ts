import type { ContentEntityType } from "./ContentRevision.js";

// Application-layer relation type registry, frozen in
// `05-implementation-policy/02_relation_type_registry.md` (17 types since the
// 2026-08-14 addendum). It lives in the DOMAIN layer, not application: the
// document's phrase "registry tetap di application layer" is the opposite of
// "lookup table in the DB" (§6 Phase Boundary: "Tidak ada lookup table DB untuk
// relation types"), not the opposite of "domain layer". Everything here is
// constants plus pure functions, no I/O — and `ContentRelationship` has to be
// able to refuse its own invalid construction. Phase 7.7 (NarrativeTransition
// `relationship_add`/`relationship_remove`) writes to `content_relationships`
// through a different path than RelationshipService, so an invariant that only
// lived in the service would simply not travel with it.
//
// `relation_type` stays a plain string column in Postgres — no enum, no CHECK
// constraint (`20260711000100_init_schema`). This file is the only thing
// standing between the column and free text.

export type RelationDirectionality = "directional" | "non_directional";

// Order follows the frozen summary table (§3): 5 non-directional, then 12
// directional.
export const RELATION_TYPES = [
  "related_to",
  "ally_of",
  "enemy_of",
  "same_location_context",
  "same_timeline_context",
  "member_of",
  "participates_in",
  "appears_in",
  "depicts",
  "located_in",
  "causes",
  "influences",
  "supports",
  "opposes",
  "betrays",
  "foreshadows",
  "resolves",
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export type RelationEndpoint = {
  entityType: ContentEntityType;
  entityId: string;
};

export type EntityPair = readonly [ContentEntityType, ContentEntityType];

type RelationTypeDefinition = {
  directionality: RelationDirectionality;
  // Display-only symbol, read from the target's side (§2). It is a stable
  // symbol, never human copy: whoever renders it decides the wording. Which of
  // the two labels applies to a given row depends on the perspective the caller
  // is reading from — that selection belongs to the DTO mapper (§7.5), not
  // here, and not to the entity.
  inverseLabel: string;
  // Written source-first. For non-directional types the list is one-way in the
  // document too; symmetry is expanded below, once, instead of being typed
  // twice per pair.
  pairs: readonly EntityPair[];
};

// Rule 11. Structural hierarchy has dedicated columns and must never be
// expressed as a generic relationship (§5):
//
//   layer parent-child   -> layers.parent_id
//   map parent-child     -> maps.parent_id
//   chapter-scene        -> scenes.chapter_id
//
// Checked as its own rule rather than left to fall out of the pair matrices,
// because the caller deserves to be told WHICH mechanism to use instead —
// "pair not allowed for this relation type" would be true but useless. The
// chapter-scene ban is cross-type on purpose, `related_to` included (§7.3):
// per-type bans would need re-auditing every time the registry grows.
const DEDICATED_HIERARCHY_PAIRS: readonly EntityPair[] = [
  ["layer", "layer"],
  ["map", "map"],
  ["chapter", "scene"],
];

function fanOut(
  source: ContentEntityType,
  targets: readonly ContentEntityType[],
): readonly EntityPair[] {
  return targets.map((target) => [source, target] as const);
}

const RELATION_TYPE_DEFINITIONS: Readonly<
  Record<RelationType, RelationTypeDefinition>
> = {
  // --- Non-directional (§1). A-B and B-A are the same relationship; the
  // inverse label equals the type itself, so there is nothing to flip on read.
  related_to: {
    directionality: "non_directional",
    inverseLabel: "related_to",
    pairs: [
      ...fanOut("character", [
        "character",
        "faction",
        "world_element",
        "event",
        "plot",
        "chapter",
        "map",
        "layer",
        "scene",
      ]),
      ...fanOut("faction", [
        "faction",
        "world_element",
        "event",
        "plot",
        "chapter",
        "map",
        "layer",
        "scene",
      ]),
      ...fanOut("world_element", [
        "world_element",
        "event",
        "plot",
        "chapter",
        "map",
        "layer",
        "scene",
      ]),
      ...fanOut("event", ["event", "plot", "chapter", "map", "layer", "scene"]),
      ...fanOut("plot", ["plot", "chapter", "map", "layer", "scene"]),
      ...fanOut("chapter", ["chapter", "map", "layer"]),
      ...fanOut("map", ["layer"]),
      ...fanOut("scene", ["scene", "map", "layer"]),
    ],
  },

  ally_of: {
    directionality: "non_directional",
    inverseLabel: "ally_of",
    pairs: [
      ...fanOut("character", ["character", "faction"]),
      ["faction", "faction"],
    ],
  },

  enemy_of: {
    directionality: "non_directional",
    inverseLabel: "enemy_of",
    pairs: [
      ...fanOut("character", ["character", "faction"]),
      ["faction", "faction"],
    ],
  },

  // Map/layer excluded: pointing AT a location is directional `located_in`.
  same_location_context: {
    directionality: "non_directional",
    inverseLabel: "same_location_context",
    pairs: [
      ...fanOut("character", [
        "character",
        "faction",
        "world_element",
        "event",
        "plot",
        "chapter",
        "scene",
      ]),
      ...fanOut("faction", [
        "faction",
        "world_element",
        "event",
        "plot",
        "chapter",
        "scene",
      ]),
      ...fanOut("world_element", [
        "world_element",
        "event",
        "plot",
        "chapter",
        "scene",
      ]),
      ...fanOut("event", ["event", "plot", "chapter", "scene"]),
      ...fanOut("plot", ["plot", "chapter", "scene"]),
      ...fanOut("chapter", ["chapter"]),
      ...fanOut("scene", ["scene"]),
    ],
  },

  // Same shape as same_location_context; map/layer excluded because they are
  // not temporal entities.
  same_timeline_context: {
    directionality: "non_directional",
    inverseLabel: "same_timeline_context",
    pairs: [
      ...fanOut("character", [
        "character",
        "faction",
        "world_element",
        "event",
        "plot",
        "chapter",
        "scene",
      ]),
      ...fanOut("faction", [
        "faction",
        "world_element",
        "event",
        "plot",
        "chapter",
        "scene",
      ]),
      ...fanOut("world_element", [
        "world_element",
        "event",
        "plot",
        "chapter",
        "scene",
      ]),
      ...fanOut("event", ["event", "plot", "chapter", "scene"]),
      ...fanOut("plot", ["plot", "chapter", "scene"]),
      ...fanOut("chapter", ["chapter"]),
      ...fanOut("scene", ["scene"]),
    ],
  },

  // --- Directional (§2). source -> target carries meaning and is never
  // swapped; the inverse label is for reading from the target's side only.
  member_of: {
    directionality: "directional",
    inverseLabel: "has_member",
    pairs: [
      ["character", "faction"],
      ["faction", "faction"],
    ],
  },

  participates_in: {
    directionality: "directional",
    inverseLabel: "has_participant",
    pairs: [
      ["character", "event"],
      ["faction", "event"],
      ["world_element", "event"],
    ],
  },

  // `event -> scene` is deliberately absent (§7.2): that fact already has a
  // canonical form as `depicts` (scene -> event). Allowing both would let one
  // domain fact be stored as two rows whose unique key differs only by
  // `relation_type` — the very inverse-row duplication Rule 12 exists to
  // prevent. General rule for future additions: no two relation types may be
  // semantic inverses of each other.
  appears_in: {
    directionality: "directional",
    inverseLabel: "features",
    pairs: [
      ...fanOut("character", ["chapter", "plot", "scene"]),
      ...fanOut("faction", ["chapter", "plot", "scene"]),
      ...fanOut("world_element", ["chapter", "plot", "scene"]),
      ...fanOut("event", ["chapter", "plot"]),
    ],
  },

  // Added by the 2026-08-14 addendum. Exactly one pair: a scene dramatises an
  // in-world happening. `chapter -> event` stays `appears_in` — a chapter holds
  // many happenings rather than dramatising one.
  depicts: {
    directionality: "directional",
    inverseLabel: "depicted_by",
    pairs: [["scene", "event"]],
  },

  located_in: {
    directionality: "directional",
    inverseLabel: "contains_semantically",
    pairs: [
      ...fanOut("character", ["map", "layer"]),
      ...fanOut("faction", ["map", "layer"]),
      ...fanOut("world_element", ["map", "layer"]),
      ...fanOut("event", ["map", "layer"]),
      // "this scene takes place there" is a statement of location, not agency
      // — same footing as `event -> map`.
      ...fanOut("scene", ["map", "layer"]),
    ],
  },

  // Source must have agency or be an event. Scene and chapter are units of
  // telling, not happenings, so neither appears here (§7.1). A scene that
  // "causes" something is two facts: depicts(scene -> event) plus
  // causes(event -> event).
  causes: {
    directionality: "directional",
    inverseLabel: "caused_by",
    pairs: [
      ...fanOut("event", ["event", "plot"]),
      ["character", "event"],
      ["faction", "event"],
    ],
  },

  influences: {
    directionality: "directional",
    inverseLabel: "influenced_by",
    pairs: [
      ...fanOut("character", [
        "character",
        "faction",
        "event",
        "plot",
        "chapter",
      ]),
      ...fanOut("faction", [
        "character",
        "faction",
        "event",
        "plot",
        "chapter",
      ]),
      ...fanOut("world_element", [
        "character",
        "faction",
        "event",
        "plot",
        "chapter",
      ]),
      ...fanOut("event", ["character", "faction", "event", "plot", "chapter"]),
      ...fanOut("plot", ["character", "faction", "event", "plot", "chapter"]),
    ],
  },

  supports: {
    directionality: "directional",
    inverseLabel: "supported_by",
    pairs: [
      ...fanOut("character", ["character", "faction", "event", "plot"]),
      ...fanOut("faction", ["character", "faction", "event", "plot"]),
    ],
  },

  opposes: {
    directionality: "directional",
    inverseLabel: "opposed_by",
    pairs: [
      ...fanOut("character", ["character", "faction", "event", "plot"]),
      ...fanOut("faction", ["character", "faction", "event", "plot"]),
    ],
  },

  betrays: {
    directionality: "directional",
    inverseLabel: "betrayed_by",
    pairs: [
      ...fanOut("character", ["character", "faction"]),
      ...fanOut("faction", ["character", "faction"]),
    ],
  },

  // Foreshadowing is a NARRATIVE act, so a unit of telling is its natural
  // source — scene even more precisely than chapter. `scene -> chapter` is
  // absent because chapter-scene is banned cross-type (§7.3).
  foreshadows: {
    directionality: "directional",
    inverseLabel: "foreshadowed_by",
    pairs: [
      ...fanOut("world_element", ["event", "plot", "chapter"]),
      ...fanOut("event", ["event", "plot", "chapter"]),
      ...fanOut("plot", ["event", "plot", "chapter"]),
      ...fanOut("chapter", ["event", "plot", "chapter"]),
      ...fanOut("scene", ["event", "plot", "scene"]),
    ],
  },

  resolves: {
    directionality: "directional",
    inverseLabel: "resolved_by",
    pairs: [
      ...fanOut("event", ["event", "plot"]),
      ...fanOut("plot", ["event", "plot"]),
      ...fanOut("chapter", ["event", "plot"]),
      ...fanOut("scene", ["event", "plot"]),
    ],
  },
};

function pairKey(source: ContentEntityType, target: ContentEntityType): string {
  return `${source}->${target}`;
}

function isSamePair(a: EntityPair, b: EntityPair): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

export function isDedicatedHierarchyPair(
  first: ContentEntityType,
  second: ContentEntityType,
): boolean {
  return DEDICATED_HIERARCHY_PAIRS.some((pair) =>
    isSamePair(pair, [first, second]),
  );
}

// Rule 11 enforced against the registry's OWN data, not just against callers.
// A future edit that slips a hierarchy pair into any matrix fails at import —
// in every test run and at boot — instead of surviving until someone happens to
// exercise that one pair.
//
// Exported because a guard that has never been seen to fire is a guard nobody
// can vouch for: it takes a matrix as an argument so a test can hand it a bad
// one, instead of the assertion being reachable only by corrupting the frozen
// constant above.
export function assertNoHierarchyPairs(
  relationType: string,
  pairs: readonly EntityPair[],
): void {
  for (const [source, target] of pairs) {
    if (isDedicatedHierarchyPair(source, target)) {
      throw new Error(
        `Relation type "${relationType}" declares dedicated hierarchy pair ${source}/${target}; hierarchy belongs to its own FK column, never to content_relationships (registry §5, §7.3).`,
      );
    }
  }
}

// Built once at module load. Non-directional types get both orders inserted
// here so that lookup stays a single Set hit and the matrices above stay
// one-way, exactly as the frozen document writes them.
const ALLOWED_PAIR_KEYS: ReadonlyMap<
  RelationType,
  ReadonlySet<string>
> = new Map(
  RELATION_TYPES.map((relationType) => {
    const definition = RELATION_TYPE_DEFINITIONS[relationType];

    assertNoHierarchyPairs(relationType, definition.pairs);

    const keys = new Set<string>();

    for (const [source, target] of definition.pairs) {
      keys.add(pairKey(source, target));

      if (definition.directionality === "non_directional") {
        keys.add(pairKey(target, source));
      }
    }

    return [relationType, keys] as const;
  }),
);

export function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}

export function directionalityOf(
  relationType: RelationType,
): RelationDirectionality {
  return RELATION_TYPE_DEFINITIONS[relationType].directionality;
}

export function isDirectional(relationType: RelationType): boolean {
  return directionalityOf(relationType) === "directional";
}

export function inverseLabelOf(relationType: RelationType): string {
  return RELATION_TYPE_DEFINITIONS[relationType].inverseLabel;
}

// The matrix as WRITTEN, one-way, before the symmetry expansion that
// `isPairAllowed` reads through. Added so the project-owned predicate
// vocabulary (`relationship_definitions`) can be seeded from this exact data
// instead of a second hand-copied matrix — two copies of a 100-pair table drift
// silently, and the drift would only surface as a rule quietly answering
// `valid`. Read-only accessor: nothing about the enforcement path changes.
//
// `isPairAllowed` cannot serve that purpose. It answers over the expanded set,
// so for a non-directional type it reports both orders and the one-way form the
// frozen document uses can no longer be recovered from it.
export function pairsOf(relationType: RelationType): readonly EntityPair[] {
  return RELATION_TYPE_DEFINITIONS[relationType].pairs;
}

export function isPairAllowed(
  relationType: RelationType,
  source: ContentEntityType,
  target: ContentEntityType,
): boolean {
  return (
    ALLOWED_PAIR_KEYS.get(relationType)?.has(pairKey(source, target)) ?? false
  );
}

// §7.4, frozen: for non-directional types compare the (entity_type, entity_id)
// tuple as strings — entity_type first, entity_id only as tie-break — and the
// lexicographically smaller side becomes `source`. Deterministic and total, so
// A↔B and B↔A produce byte-identical rows and the unique index does the
// dedup on its own, with no read-before-write.
//
// The values compared are the stored `ContentEntityType` values (`map`,
// `world_element`, …) — never display names or route segments (`/world-maps`),
// whose ordering differs (`map < scene`, but `world_map > scene`).
//
// Directional types are returned untouched: Rule 10. `A -> B` and `B -> A` are
// two legitimate, different relationships there (`influences` both ways), not
// duplicates.
export function canonicalizeEndpoints(
  relationType: RelationType,
  source: RelationEndpoint,
  target: RelationEndpoint,
): { source: RelationEndpoint; target: RelationEndpoint } {
  if (isDirectional(relationType)) {
    return { source, target };
  }

  const targetSortsFirst =
    target.entityType < source.entityType ||
    (target.entityType === source.entityType &&
      target.entityId < source.entityId);

  return targetSortsFirst
    ? { source: target, target: source }
    : { source, target };
}
