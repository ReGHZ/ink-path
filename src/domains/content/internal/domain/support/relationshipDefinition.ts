import type { ContentEntityType } from "./ContentRevision.js";

// The shape rules that stay MACHINE-OWNED now that the vocabulary is project
// data (`05-implementation-policy/02_relation_type_registry.md` §REVISI
// 2026-08-17: "aturan bentuk tetap mengikat, sumbernya jadi data"). What used to
// be a closed union plus a hardcoded pair matrix in `relationTypeRegistry.ts` is
// a row in `relationship_definitions` now; what remains here is everything true
// of ANY predicate — author-coined ones included — and therefore unable to live
// in the data it judges:
//
//   - which entity pairs belong to a dedicated FK column instead (§5, §7.3)
//   - how a definition's signatures answer "is this pair allowed" (§4 rule 3)
//   - canonical orientation for non-directional predicates (§7.4)
//
// NOTHING IN THIS FILE KNOWS A PREDICATE NAME, and that absence is the point of
// step 4 rather than a stylistic preference: a name here would be the closed
// vocabulary growing back, one exception at a time. It is also grep-able, which
// is what makes the property enforceable after everyone has forgotten why.

export type RelationDirectionality = "directional" | "non_directional";

export type RelationEndpoint = {
  entityType: ContentEntityType;
  entityId: string;
};

// One accepted (subject, object) combination — a row of
// `relationship_definition_signatures`. `objectEntityType: null` means the
// predicate is UNARY and this row only names a subject type that may hold it
// (`prisma/relationship-definition.prisma`).
export type RelationshipSignature = {
  subjectEntityType: ContentEntityType;
  objectEntityType: ContentEntityType | null;
};

// The part of a `relationship_definitions` row the DOMAIN needs, and no more.
// `id`, `projectId`, `transitive` and `subclassOfId` are deliberately absent:
// they belong to the rule engine and to persistence, and an entity that never
// receives them cannot quietly start depending on them.
export type RelationshipDefinition = {
  predicate: string;
  directionality: RelationDirectionality;
  objectRequired: boolean;
  inverseLabel: string;
  signatures: readonly RelationshipSignature[];
};

// Rule 11. Structural hierarchy has dedicated columns and must never be
// expressed as a generic relationship (§5):
//
//   layer parent-child   -> layers.parent_id
//   map parent-child     -> maps.parent_id
//   chapter-scene        -> scenes.chapter_id
//
// Kept as its own rule rather than left to fall out of a definition's
// signatures, because the caller deserves to be told WHICH mechanism to use
// instead — "pair not allowed for this predicate" would be true but useless.
// The database refuses to store such a signature at all
// (`relationship_definition_signatures_no_dedicated_hierarchy`, migration
// `20260818023920`), so this is the caller-facing half of a rule the schema
// already holds, not a second source of truth. The chapter-scene ban is
// cross-type on purpose (§7.3): a per-predicate ban would need re-auditing every
// time an author coins one, which is now continuously.
const DEDICATED_HIERARCHY_PAIRS: ReadonlyArray<readonly [
  ContentEntityType,
  ContentEntityType,
]> = [
  ["layer", "layer"],
  ["map", "map"],
  ["chapter", "scene"],
];

export function isDedicatedHierarchyPair(
  first: ContentEntityType,
  second: ContentEntityType,
): boolean {
  return DEDICATED_HIERARCHY_PAIRS.some(
    ([left, right]) =>
      (left === first && right === second) ||
      (left === second && right === first),
  );
}

// Rule 3, answered against the definition instead of against a constant.
//
// Signatures are stored ONE WAY, exactly as the frozen document writes the
// matrix, and symmetry is expanded HERE — the same division of labour
// `ALLOWED_PAIR_KEYS` used to have, moved to the read side because the writer is
// now an author rather than this codebase (`prisma/relationship-definition.prisma`:
// "the reader expands symmetry"). Storing both orders instead would make the
// stored matrix disagree with the document it was seeded from.
//
// A unary predicate answers `false` for every pair, and that is correct rather
// than incidental: a relationship row always has two endpoints, so a predicate
// with no object side can never be one. The caller-facing rejection for that
// case names ARITY, not the pair — see `ContentRelationship.create()`.
export function isPairAllowedBy(
  definition: RelationshipDefinition,
  source: ContentEntityType,
  target: ContentEntityType,
): boolean {
  return definition.signatures.some((signature) => {
    if (signature.objectEntityType === null) {
      return false;
    }

    if (
      signature.subjectEntityType === source &&
      signature.objectEntityType === target
    ) {
      return true;
    }

    return (
      definition.directionality === "non_directional" &&
      signature.subjectEntityType === target &&
      signature.objectEntityType === source
    );
  });
}

// §7.4, frozen: for non-directional predicates compare the
// (entity_type, entity_id) tuple as strings — entity_type first, entity_id only
// as tie-break — and the lexicographically smaller side becomes `source`.
// Deterministic and total, so A↔B and B↔A produce byte-identical rows and the
// unique index does the dedup on its own, with no read-before-write.
//
// The values compared are the stored `ContentEntityType` values (`map`,
// `world_element`, …) — never display names or route segments (`/world-maps`),
// whose ordering differs (`map < scene`, but `world_map > scene`).
//
// Directional predicates are returned untouched: Rule 10. `A -> B` and `B -> A`
// are two legitimate, different relationships there, not duplicates.
//
// Takes the DIRECTIONALITY rather than the whole definition: this is the one
// rule that reads a single field, and passing the field makes it impossible for
// a future edit to reach for a predicate name it has no business knowing.
export function canonicalizeEndpoints(
  directionality: RelationDirectionality,
  source: RelationEndpoint,
  target: RelationEndpoint,
): { source: RelationEndpoint; target: RelationEndpoint } {
  if (directionality === "directional") {
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
