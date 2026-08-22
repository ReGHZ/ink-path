import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

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
  // The row's id, and it is DOMAIN data rather than a persistence detail:
  // premis §6.2 turns a predicate into a first-order constant precisely by
  // making it a row with an id, and an assertion references it by that id
  // (`assertions.relationship_definition_id`). An earlier draft left it
  // out as "the rule engine's business"; the `has_provenance` CHECK rejected the
  // first parentless assertion written without it.
  id: string;
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
// `20260820000000_phase7_phase11_additions`, §dari: `20260818023920`), so this is the caller-facing half of a rule the schema
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

// ONE sentence with TWO callers — `ContentRelationship.create()` (CRUD write)
// and `Assertion` (declare path) — so it lives beside the rule it explains
// rather than being pasted twice. It says the predicate is VALID on purpose: an
// author who defined a unary predicate did nothing wrong, the log simply has no
// home for unary facts yet, and that home is a decided shape on a scheduled
// slice (`03-database-design/15` §ADDENDUM butir 4). The earlier wording —
// "takes no object and cannot be stored as a relationship" — read as "your
// predicate is broken" and sent authors renaming a word that was never the
// problem (gate B8-5).
export function unaryPredicateHasNoLogHomeYet(predicate: string): string {
  return `Predicate ${predicate} takes no object, so it cannot be stored as a relationship — the predicate itself is valid, but unary facts have no home in the log yet (03-database-design/15 §ADDENDUM butir 4: decided shape, separate slice)`;
}

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

// ---------------------------------------------------------------------------
// WRITE side: the shape rules a predicate the AUTHOR invents has to satisfy.
//
// The vocabulary became project data at step 4a, but "data" was never the same
// as "anything goes": the shape rules stayed machine-owned (registry §REVISI
// 2026-08-17). Until this function existed the only thing enforcing them on a
// NEW predicate was the database — `relationship_definitions_predicate_shape`
// and the two partial unique indexes on the signature table. That is one owner,
// and this project's rule is two: the guard that answers the CALLER, and the
// constraint that survives a caller nobody reviewed. This is the first half.
//
// It is deliberately a pure function over a draft, not a persisted aggregate:
// nothing here reads or writes, so the service can validate before it opens a
// transaction and the tests need no database at all.
export type RelationshipDefinitionDraft = {
  predicate: string;
  directionality: RelationDirectionality;
  objectRequired: boolean;
  inverseLabel: string;
  // Human text, and the reason it is NOT on `RelationshipDefinition` above: the
  // rule engine, the projector and the relationship validator all consume that
  // type and none of them may render anything. Putting display text there would
  // force every fake in those suites to invent a label for a decision it does
  // not take. `RelationshipDefinitionDetail` carries it instead.
  displayLabel: string;
  inverseDisplayLabel: string;
  signatures: readonly RelationshipSignature[];
};

// The vocabulary as the AUTHOR sees it: the matching shape plus the words. Only
// the vocabulary-management surface (create + list) uses this.
export type RelationshipDefinitionDetail = RelationshipDefinition & {
  displayLabel: string;
  inverseDisplayLabel: string;
};

// Mirrors the CHECK `predicate ~ '^[a-z][a-z0-9_]*$'`. Kept as one constant so a
// future loosening cannot happen here without the migration noticing.
const PREDICATE_PATTERN = /^[a-z][a-z0-9_]*$/;

// The author types ONE word; the symbol is derived from it and never shown.
//
// That direction — text first, symbol second — is what
// `notes/usulan-ux-pencatatan-fakta.md` §8.3/§8.5 costs out: create-on-use means
// the author writes `mati` in the fact panel and answers one question about
// arity, not four name fields. A symbol they have to invent is a field they can
// get wrong for a value they never read again.
//
// Returns null when nothing usable survives — which is not an error and not an
// edge case: `結婚`, `الزواج` and `брак` all reduce to nothing here, because the
// pattern the DATABASE enforces is ASCII. The caller then generates an opaque
// symbol. Refusing those words instead would make this the one place in the
// system that assumes a script (Phase 5 refused that: `projects.language` is
// free text, the chunker segments with the root Unicode locale).
// The namespace generated symbols live in. Reserved HERE rather than in the
// service, because the rule is about which symbols a LABEL may occupy: nothing
// stops an author from typing the literal text `p_1a2b3c4d`, and if a derived
// symbol could land in this namespace it could collide with a symbol generated
// later for a label in another script — refusing an author who typed nothing
// unusual, with a message naming a value they never saw. A label that derives
// into this shape is treated as "no usable symbol" instead, so the author keeps
// their word and simply gets a generated symbol like any other unmappable label.
const RESERVED_GENERATED_SYMBOL = /^p_[0-9a-f]{1,12}$/;

export function symbolFromLabel(label: string): string | null {
  const symbol = label
    .normalize("NFKD")
    // Strip combining marks so `à` becomes `a` rather than disappearing — for
    // Latin-with-diacritics the derived symbol still resembles the word.
    .replaceAll(/\p{M}+/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  if (symbol.length === 0 || !PREDICATE_PATTERN.test(symbol)) {
    return null;
  }

  if (RESERVED_GENERATED_SYMBOL.test(symbol)) {
    return null;
  }

  return symbol;
}

function signatureKey(signature: RelationshipSignature): string {
  return `${signature.subjectEntityType}|${signature.objectEntityType ?? ""}`;
}

export function draftRelationshipDefinition(
  input: RelationshipDefinitionDraft,
): RelationshipDefinitionDraft {
  const predicate = input.predicate.trim();

  if (!PREDICATE_PATTERN.test(predicate)) {
    throw new DomainError(
      DomainErrorCode.DOMAIN_VALIDATION_FAILED,
      `Predicate ${input.predicate} must be lower snake_case starting with a letter (${PREDICATE_PATTERN.source})`,
    );
  }

  const inverseLabel = input.inverseLabel.trim();

  if (inverseLabel.length === 0) {
    throw new DomainError(
      DomainErrorCode.DOMAIN_VALIDATION_FAILED,
      `Predicate ${predicate} needs an inverse label: it is the symbol the object's side is rendered with (§7.5), and there is no sane default for it`,
    );
  }

  // NO charset rule here, and that is the point of the column existing: the
  // predicate is ASCII because a machine matches it, while these are what a
  // person reads. Phase 5 already refused to assume a language anywhere in this
  // system (`projects.language` is free text, the chunker segments with the root
  // Unicode locale `und`, the embedding model is multilingual) — a vocabulary
  // that only accepts Latin script would be the single place that breaks it.
  const displayLabel = input.displayLabel.trim();
  const inverseDisplayLabel = input.inverseDisplayLabel.trim();

  for (const [value, field] of [
    [displayLabel, "display label"],
    [inverseDisplayLabel, "inverse display label"],
  ] as const) {
    if (value.length === 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Predicate ${predicate} needs a ${field}: a row the author cannot read is a row they cannot pick`,
      );
    }
  }

  if (input.signatures.length === 0) {
    throw new DomainError(
      DomainErrorCode.DOMAIN_VALIDATION_FAILED,
      `Predicate ${predicate} needs at least one signature — a predicate no pair of entities can use is a predicate nothing can ever assert`,
    );
  }

  const seen = new Set<string>();

  for (const signature of input.signatures) {
    // ARITY, and the reason it is checked HERE rather than left to the two
    // partial unique indexes: those enforce that the binary rows and the unary
    // rows do not collide, not that a definition picked one arity and stuck to
    // it. A definition with `objectRequired` and an object-less signature would
    // store cleanly and then reject every assertion made through it.
    if (input.objectRequired && signature.objectEntityType === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Predicate ${predicate} takes an object, so every signature needs one; ${signature.subjectEntityType} has none`,
      );
    }

    if (!input.objectRequired && signature.objectEntityType !== null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Predicate ${predicate} takes no object, so no signature may name one; ${signature.subjectEntityType} names ${signature.objectEntityType}`,
      );
    }

    // Rule 11, the same one `ContentRelationship.create()` answers at assert
    // time — refused at DEFINE time as well, because a signature nothing may
    // ever use is a trap the author only discovers on their first assertion.
    if (
      signature.objectEntityType !== null &&
      isDedicatedHierarchyPair(
        signature.subjectEntityType,
        signature.objectEntityType,
      )
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Pair ${signature.subjectEntityType}/${signature.objectEntityType} is structural hierarchy with its own FK column and must never be stored as a content relationship`,
      );
    }

    const key = signatureKey(signature);

    if (seen.has(key)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Signature ${key} is declared twice for predicate ${predicate}`,
      );
    }

    // A non-directional predicate is expanded symmetrically by
    // `isPairAllowedBy()`, so (A,B) already permits (B,A). Storing the mirror
    // too would be one MEANING with two rows — and the partial unique indexes
    // cannot see that, because the rows differ.
    if (
      input.directionality === "non_directional" &&
      signature.objectEntityType !== null &&
      seen.has(
        signatureKey({
          subjectEntityType: signature.objectEntityType,
          objectEntityType: signature.subjectEntityType,
        }),
      )
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Predicate ${predicate} is non-directional, so ${signature.subjectEntityType}/${signature.objectEntityType} is already covered by its mirror — declare it once`,
      );
    }

    seen.add(key);
  }

  return {
    predicate,
    directionality: input.directionality,
    objectRequired: input.objectRequired,
    inverseLabel,
    displayLabel,
    inverseDisplayLabel,
    signatures: input.signatures.map((signature) => ({ ...signature })),
  };
}
