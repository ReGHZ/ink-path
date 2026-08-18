import {
  RELATION_TYPES,
  directionalityOf,
  inverseLabelOf,
  pairsOf,
  type RelationDirectionality,
} from "./relationTypeRegistry.js";

import type { ContentEntityType } from "./ContentRevision.js";

// The 19 predicates every new project starts with.
//
// Step 1 of the interleaved work order (`notes/premis-symbolic-rule-engine.md`
// §8b): the vocabulary moves from a closed union in code to rows a project
// owns. These 19 are a STARTING POINT, not a ceiling — the whole reason the
// premise changed is that a xianxia novel needs `master_of` and a political
// drama needs `vassal_of`, and neither should require a deploy.
//
// 17 of them are DERIVED from `relationTypeRegistry.ts` rather than retyped.
// The registry stays the enforcement path for `content_relationships` until
// step 4 retires it, so for a while the same matrix has to exist in two places;
// deriving is what keeps "for a while" from becoming "and then they disagreed".
// The 67 exhaustiveness tests that lock the registry to
// `05-implementation-policy/02_relation_type_registry.md` therefore lock the
// seed too, for free.
//
// The remaining two — `owns` and `rules` — are the 2026-08-17 addendum (§8).
// They are NOT in the registry union: the code deliberately stays at 17 until a
// replacement exists (`.ai/current.md`), while the seed is 19 because the
// addendum is frozen. That gap is the recorded code↔seed debt, and writing the
// two here rather than widening the union is what keeps step 1 additive.

// Twin of the `relationship_definitions_predicate_format` CHECK in
// `20260818023920_add_relationship_definitions`. Two copies of one rule, in two
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
  // vertical slice in step 3 introduces, and they are the reason the signature
  // table allows a missing object side at all.
  objectEntityType: ContentEntityType | null;
};

export type RelationshipDefinitionSeed = {
  predicate: string;
  objectRequired: boolean;
  directionality: RelationDirectionality;
  inverseLabel: string;
  transitive: boolean;
  signatures: readonly RelationshipDefinitionSignatureSeed[];
};

// Written source-first, exactly as the addendum writes them
// (`05-implementation-policy/02_relation_type_registry.md` §2 `owns`/`rules`).
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
// registry itself: all 17 are relations between two entities, and `owns`/`rules`
// are written as `source -> target` in the addendum. Transitivity is left false
// because no frozen document declares any of the 19 transitive — and under
// `07_validation_ast_schema.md` §2 the flag makes the ENGINE materialise a
// closure, so setting it on a guess would silently invent facts no author
// wrote. `master_of`, the example that motivated the flag, is an author-coined
// predicate, not one of these.
const FROM_REGISTRY: readonly RelationshipDefinitionSeed[] = RELATION_TYPES.map(
  (relationType) => ({
    predicate: relationType,
    objectRequired: true,
    directionality: directionalityOf(relationType),
    inverseLabel: inverseLabelOf(relationType),
    transitive: false,
    signatures: pairsOf(relationType).map(([source, target]) => ({
      subjectEntityType: source,
      objectEntityType: target,
    })),
  }),
);

export const RELATIONSHIP_DEFINITION_SEED: readonly RelationshipDefinitionSeed[] =
  [...FROM_REGISTRY, ...ADDENDUM_2026_08_17];

export const RELATIONSHIP_DEFINITION_SEED_COUNT =
  RELATIONSHIP_DEFINITION_SEED.length;
