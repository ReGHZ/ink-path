import type { ContentEntityType } from "./ContentRevision.js";
import type {
  RelationDirectionality,
  RelationshipDefinition,
} from "./relationshipDefinition.js";

// The 19 predicates every new project starts with.
//
// THIS IS BUSINESS DATA, NOT A RULE. Nothing validates against this table: a
// project may delete every row it seeds, an author may coin predicates it never
// heard of, and a project seeded with nothing still works. It exists so a writer
// does not begin at an empty vocabulary — friction, which is a product concern
// (`05-implementation-policy/02_relation_type_registry.md` §REVISI 2026-08-17:
// "ongkos penulis harus membuatnya sendiri = gesekan"). Enforcement lives in
// `relationship_definitions` rows and in `relationshipDefinition.ts`; the two
// were the same file until step 4, and conflating them is what kept the closed
// vocabulary alive.
//
// The 17 + 2 split is historical only: 17 come from the frozen matrix
// (§1-§3, `depicts` added by the 2026-08-14 addendum) and 2 from the 2026-08-17
// addendum §8 (`owns`, `rules`). They are one flat seed table now — the union
// that used to gate `content_relationships` was retired in step 4, so there is
// no second copy left to drift from.

// Twin of the `relationship_definitions_predicate_format` CHECK in
// `20260820000000_phase7_phase11_additions` (§dari: 20260818023920_add_relationship_definitions). Two copies of one rule, in two
// languages, so neither is optional: the DB copy is what actually holds when an
// author coins a predicate through any path, and this one is what lets the app
// reject it with a message instead of a constraint violation. The integration
// test asserts the database really refuses what this pattern refuses — that
// assertion is the only thing keeping the pair honest.
export const PREDICATE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export type RelationshipDefinitionSignatureSeed = {
  subjectEntityType: ContentEntityType;
  // `null` = the predicate takes no object. None of the 19 are unary; the
  // column exists because unary predicates (`dead`, `exiled`) are what the
  // vertical slice in step 3 introduced, and they are the reason the signature
  // table allows a missing object side at all.
  objectEntityType: ContentEntityType | null;
};

// Default display text is DERIVED from the symbol (`member_of` -> "member of"),
// neither hand-written nineteen times nor translated: these nineteen rows are a
// default seed, and the real wording is the author's decision, not this repo's.
export function displayLabelFromSymbol(symbol: string): string {
  return symbol.replaceAll('_', " ");
}

export type RelationshipDefinitionSeed = {
  predicate: string;
  objectRequired: boolean;
  directionality: RelationDirectionality;
  inverseLabel: string;
  transitive: boolean;
  signatures: readonly RelationshipDefinitionSignatureSeed[];
};

// Written source-first, one way, exactly as the frozen document writes the
// matrix (§1, §2). Symmetry for non-directional predicates is expanded by the
// READER (`relationshipDefinition.ts` `isPairAllowedBy`), never stored twice —
// storing both orders would make the seeded rows disagree with the document
// they were copied from.
type EntityPair = readonly [ContentEntityType, ContentEntityType];

type SeededMatrixEntry = {
  directionality: RelationDirectionality;
  // Display-only symbol read from the object's side (§2, §7.5). A stable
  // symbol, never human copy: whoever renders it decides the wording.
  inverseLabel: string;
  pairs: readonly EntityPair[];
};

// The 17 names are a LITERAL LIST, and the local union below exists only to keep
// this table exhaustively typed — a missing entry is a compile error rather than
// a silently shorter seed. It is deliberately NOT exported: the moment anything
// outside this file can import it, the closed vocabulary is back.
const SEEDED_MATRIX_PREDICATES = [
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

type SeededMatrixPredicate = (typeof SEEDED_MATRIX_PREDICATES)[number];

function fanOut(
  source: ContentEntityType,
  targets: readonly ContentEntityType[],
): readonly EntityPair[] {
  return targets.map((target) => [source, target] as const);
}

const SEEDED_MATRIX: Readonly<
  Record<SeededMatrixPredicate, SeededMatrixEntry>
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

// The 2026-08-17 addendum (§8), written source-first like the matrix above.
const ADDENDUM_2026_08_17: readonly RelationshipDefinitionSeed[] = [
  {
    predicate: "owns",
    objectRequired: true,
    directionality: "directional",
    inverseLabel: "owned_by",
    transitive: false,
    signatures: [
      { subjectEntityType: "character", objectEntityType: "world_element" },
      { subjectEntityType: "faction", objectEntityType: "world_element" },
    ],
  },
  {
    predicate: "rules",
    objectRequired: true,
    directionality: "directional",
    inverseLabel: "ruled_by",
    transitive: false,
    signatures: [
      { subjectEntityType: "character", objectEntityType: "faction" },
      { subjectEntityType: "character", objectEntityType: "map" },
      { subjectEntityType: "faction", objectEntityType: "faction" },
      { subjectEntityType: "faction", objectEntityType: "map" },
    ],
  },
];

// Every seeded predicate is binary and non-transitive.
//
// Both are statements, not defaults. `object_required: true` follows from the
// matrix itself: all 17 are relations between two entities, and `owns`/`rules`
// are written as `source -> target` in the addendum. Transitivity is left false
// because no frozen document declares any of the 19 transitive — and under
// `07_validation_ast_schema.md` §2 the flag makes the ENGINE materialise a
// closure, so setting it on a guess would silently invent facts no author
// wrote. `master_of`, the example that motivated the flag, is an author-coined
// predicate, not one of these.
const FROM_MATRIX: readonly RelationshipDefinitionSeed[] =
  SEEDED_MATRIX_PREDICATES.map((predicate) => ({
    predicate,
    objectRequired: true,
    directionality: SEEDED_MATRIX[predicate].directionality,
    inverseLabel: SEEDED_MATRIX[predicate].inverseLabel,
    transitive: false,
    signatures: SEEDED_MATRIX[predicate].pairs.map(([source, target]) => ({
      subjectEntityType: source,
      objectEntityType: target,
    })),
  }));

export const RELATIONSHIP_DEFINITION_SEED: readonly RelationshipDefinitionSeed[] =
  [...FROM_MATRIX, ...ADDENDUM_2026_08_17];

export const RELATIONSHIP_DEFINITION_SEED_COUNT =
  RELATIONSHIP_DEFINITION_SEED.length;

// The seed rows in the shape the DOMAIN reads them, for callers that need a
// definition without a database — the in-memory reader used by unit tests, and
// nothing else. Exported from here rather than rebuilt in a test helper so a
// test can never assert against a vocabulary the seeder would not have written.
export function seedAsDefinition(
  seed: RelationshipDefinitionSeed,
): RelationshipDefinition {
  return {
    // A stable placeholder, NOT a real row id: the seeder generates ids when it
    // writes (`PrismaRelationshipDefinitionSeeder` — the id is its ownership
    // token). Anything reaching a database through this value is a bug, and it
    // is shaped to say so rather than to look plausible.
    id: `seed:${seed.predicate}`,
    predicate: seed.predicate,
    directionality: seed.directionality,
    objectRequired: seed.objectRequired,
    inverseLabel: seed.inverseLabel,
    signatures: seed.signatures,
  };
}

const SEED_BY_PREDICATE: ReadonlyMap<string, RelationshipDefinitionSeed> =
  new Map(RELATIONSHIP_DEFINITION_SEED.map((seed) => [seed.predicate, seed]));

// Looks a seeded predicate up as a DEFINITION, for callers that need one without
// a database — unit tests, and nothing else.
//
// Throws rather than returning null on purpose: a caller asking for a predicate
// the seed does not contain has a typo, and a null here would travel until it
// surfaced as "pair not allowed" three layers away. Nothing in `src/` outside a
// `.test.ts` may call this — that is the property that keeps the seed from
// becoming a validation source again, and `grep` is how it is enforced.
// The whole seeded vocabulary as the domain reads it, keyed by predicate — the
// in-memory twin of `RelationshipDefinitionReader.findAllByProject`. Same
// restriction as `seededDefinition`: `.test.ts` only.
export const SEEDED_DEFINITIONS: ReadonlyMap<string, RelationshipDefinition> =
  new Map(
    RELATIONSHIP_DEFINITION_SEED.map((seed) => [
      seed.predicate,
      seedAsDefinition(seed),
    ]),
  );

export function seededDefinition(predicate: string): RelationshipDefinition {
  const seed = SEED_BY_PREDICATE.get(predicate);

  if (seed === undefined) {
    throw new Error(`No seeded predicate named "${predicate}"`);
  }

  return seedAsDefinition(seed);
}
