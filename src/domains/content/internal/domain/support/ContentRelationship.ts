import {
  canonicalizeEndpoints,
  isDedicatedHierarchyPair,
  isPairAllowedBy,
  type RelationEndpoint,
  type RelationshipDefinition,
} from "./relationshipDefinition.js";
import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

import type { ContentEntityType } from "./ContentRevision.js";

// M:N relationship between two content entities (`content_relationships`,
// `ink-path/prisma/content-support.prisma:55-81`). Flow 4
// (`02-system-design/03_flow_04_content_relationship.md`) plus the 12 validation
// rules of `05-implementation-policy/02_relation_type_registry.md` §4.
//
// Rules 4 and 11 live in validate(); rules 1, 3, 9 and 10 in create(), the write
// path only — 1 and 3 moved there in step 4 because they now read a DEFINITION
// ROW, and reconstitute() has none (see the note in validate()). Rule 12 is
// structural; 5, 6, 7 and 8 (endpoint existence, same project, permission) need
// a repository or a membership context and stay in RelationshipService. The split is not
// stylistic: Phase 7.7
// (NarrativeTransition `relationship_add`/`relationship_remove`) writes to this
// same table through a different path than RelationshipService, so an invariant
// that only lived in the service would not travel with it.
//
// Rule 12 ("no second, mirrored row") is satisfied structurally rather than by a
// check: create() returns exactly one aggregate, and there is no code path in
// this file that produces a second one.

export type ContentRelationshipProperties = {
  id: string;
  version: number;
  projectId: string;
  sourceEntityType: ContentEntityType;
  sourceEntityId: string;
  targetEntityType: ContentEntityType;
  targetEntityId: string;
  // Plain `string` since step 4. The closed union it used to be WAS the
  // vocabulary; now the vocabulary is `relationship_definitions` rows, and the
  // composite FK `(project_id, relation_type) -> (project_id, predicate)` is
  // what keeps this column from being free text. A union here would be a second
  // vocabulary, which is the exact condition step 4 removed.
  relationType: string;
  note: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Entity types stay unions because they arrive as route constants, never as free
// text (registry §4 rule 2). `relationType` cannot: it is an author-owned symbol
// with no compile-time extent at all.
export type CreateContentRelationshipProperties = {
  id: string;
  projectId: string;
  relationType: string;
  // The project's row for `relationType`, loaded by the caller. Handed IN rather
  // than looked up here so the entity stays free of I/O while still refusing its
  // own invalid construction — both write paths (RelationshipService and the 7.7
  // apply path) load it, so the invariant travels with the aggregate exactly as
  // it did when the matrix was a constant.
  definition: RelationshipDefinition;
  source: RelationEndpoint;
  target: RelationEndpoint;
  note?: string | null;
  createdByUserId: string;
  now: Date;
};

// `note` is the only mutable field: `relation_type` and both endpoints are the
// row's natural identity (unique constraint on
// `(project_id, relation_type, source_*, target_*)`), so changing a type is
// delete + create, not an update — Flow 4 §Update Relation addendum 2026-08-14.
export type UpdateContentRelationshipNoteProperties = {
  note: string | null;
  now: Date;
};

export class ContentRelationship {
  private constructor(private readonly props: ContentRelationshipProperties) {
    ContentRelationship.validate(props);
  }

  static create(
    props: CreateContentRelationshipProperties,
  ): ContentRelationship {
    // Rule 1. The caller resolved the predicate against the project's own
    // vocabulary and hands the row in; this only refuses a MISMATCHED pair,
    // which would mean the caller validated one predicate and stored another.
    // "No such predicate" is answered before create() is reached, because a
    // missing row means there is nothing to hand in.
    if (props.definition.predicate !== props.relationType) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Definition ${props.definition.predicate} does not describe relation type ${props.relationType}`,
      );
    }

    // ARITY, the check registry §REVISI 2026-08-17 (a) says falls due together
    // with the vocabulary becoming data. A relationship row has two endpoints by
    // construction, so a unary predicate — `dead(char)`, the kind the vertical
    // slice introduced — can never be one. Rejected by NAME here rather than
    // left to rule 3: "predicate takes no object" is the caller's actual mistake,
    // while "pair not allowed" would send them looking for a signature to add.
    if (!props.definition.objectRequired) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Predicate ${props.relationType} takes no object and cannot be stored as a relationship`,
      );
    }

    // Rules 9 and 10. Canonicalization happens before construction because the
    // canonical orientation IS the stored row's identity (registry §7.4): it is
    // what makes `A↔B` and `B↔A` collide on the unique index, which is how
    // duplicates are detected without any read-before-write (Flow 4 step 8,
    // superseded 2026-08-14). Directional predicates are returned untouched, so
    // `A -> B` and `B -> A` remain two legitimate relationships.
    const { source, target } = canonicalizeEndpoints(
      props.definition.directionality,
      props.source,
      props.target,
    );

    // Rule 11 before rule 3, the same order validate() uses and for the same
    // reason: both reject the pair, only this one names the mechanism to use
    // instead. Checked here as well so the caller-facing message arrives before
    // rule 3 can pre-empt it with a vaguer one.
    if (isDedicatedHierarchyPair(source.entityType, target.entityType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Pair ${source.entityType}/${target.entityType} is structural hierarchy with its own FK column and must never be stored as a content relationship`,
      );
    }

    // Rule 3, against the definition's signatures instead of a constant matrix.
    // Checked on the CANONICAL endpoints, which cannot change the answer —
    // symmetry is expanded by isPairAllowedBy() for non-directional predicates
    // and canonicalization is the identity for directional ones — but keeps this
    // check reading the same values that get stored.
    if (!isPairAllowedBy(props.definition, source.entityType, target.entityType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Relation type ${props.relationType} does not allow the pair ${source.entityType} -> ${target.entityType}`,
      );
    }

    return new ContentRelationship({
      id: props.id,
      version: 0,
      projectId: props.projectId,
      sourceEntityType: source.entityType,
      sourceEntityId: source.entityId,
      targetEntityType: target.entityType,
      targetEntityId: target.entityId,
      relationType: props.relationType,
      note: normalizeOptionalText(props.note ?? null),
      createdByUserId: props.createdByUserId,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(
    props: ContentRelationshipProperties,
  ): ContentRelationship {
    return new ContentRelationship(props);
  }

  get id(): string {
    return this.props.id;
  }

  get version(): number {
    return this.props.version;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get sourceEntityType(): ContentEntityType {
    return this.props.sourceEntityType;
  }

  get sourceEntityId(): string {
    return this.props.sourceEntityId;
  }

  get targetEntityType(): ContentEntityType {
    return this.props.targetEntityType;
  }

  get targetEntityId(): string {
    return this.props.targetEntityId;
  }

  get relationType(): string {
    return this.props.relationType;
  }

  get note(): string | null {
    return this.props.note;
  }

  get createdByUserId(): string | null {
    return this.props.createdByUserId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // Returns false when nothing changed, exactly like Scene.updateDetails() —
  // the service uses that to skip the repository call entirely, so a no-op
  // PATCH does not burn a version increment.
  //
  // `version` is deliberately left untouched: the aggregate keeps the version it
  // was read at because the adapter needs it as the guard
  // (`where: { id, version }`), and the increment belongs to the persistence
  // mapper — Phase 6 precedent `SceneMapper.toUpdatePersistence()`
  // (`../../infrastructure/story/SceneMapper.ts:59-72`, `version: { increment: 1 }`).
  updateNote(input: UpdateContentRelationshipNoteProperties): boolean {
    const note = normalizeOptionalText(input.note);

    if (note === this.props.note) {
      return false;
    }

    const nextProperties: ContentRelationshipProperties = {
      ...this.props,
      note,
      updatedAt: input.now,
    };

    ContentRelationship.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  toSnapshot(): ContentRelationshipProperties {
    return { ...this.props };
  }

  private static validate(props: ContentRelationshipProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Content relationship id is required",
      );
    }

    if (!Number.isInteger(props.version) || props.version < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Content relationship version must be a non-negative integer",
      );
    }

    if (props.projectId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project id is required",
      );
    }

    // Unlike every Phase 4-6 content entity, `created_by_user_id` is nullable
    // here (`content-support.prisma:67`, FK `onDelete: SetNull`): an
    // authorless relationship is a legitimate persisted state that outlives the
    // account that created it, so reconstitute() must accept null. A blank
    // string is still rejected — that means a caller had a value and lost it.
    // create() cannot produce null: the author is always known at that point.
    if (props.createdByUserId !== null && props.createdByUserId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Created by user id must not be blank",
      );
    }

    // Endpoint ids are opaque established-aggregate tokens, same treatment as
    // Scene.chapterId (`../story/Scene.ts:229-238`): whether the row exists and
    // belongs to this project is a cross-aggregate fact only that entity's own
    // row can answer, checked by RelationshipService (registry §4 rules 5-7)
    // before create() is ever called.
    if (props.sourceEntityId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Source entity id is required",
      );
    }

    if (props.targetEntityId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Target entity id is required",
      );
    }

    // Rule 1 is NOT repeated here, and the omission is the substantive change of
    // step 4 rather than an oversight. Answering "is this a real predicate"
    // requires the project's definition rows, and reconstitute() — the path a
    // stored row arrives through — has none to consult without doing I/O inside
    // a constructor. The column is not unguarded: the composite foreign key
    // `(project_id, relation_type) -> relationship_definitions(project_id,
    // predicate)` refuses a row whose predicate the project does not define, and
    // it refuses it for every writer, including SQL run by hand. That is a
    // stronger guarantee than the union it replaced, which only bound callers
    // who went through this file.
    //
    // Rule 3 is absent for the same reason and with a weaker guarantee: the FK
    // proves the predicate exists, not that the stored pair still matches one of
    // its signatures. An author who narrows a signature set after the fact
    // leaves rows behind that no longer satisfy it. That is deliberately a
    // data-audit question, not a constructor's — the argument at the end of this
    // method for rules 9 and 10 applies unchanged: a row this constructor
    // refused to build could never be read, and therefore never be deleted,
    // through the API again.
    if (props.relationType.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Relation type is required",
      );
    }

    // Rule 4. Both halves must match: the same id under a different entity type
    // is a different entity, not a self-relationship.
    if (
      props.sourceEntityType === props.targetEntityType &&
      props.sourceEntityId === props.targetEntityId
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Self-relationship is not allowed: source and target are the same entity",
      );
    }

    // Rule 11. Unlike rules 1 and 3 this one needs no definition — it reads only
    // the two entity types — so it stays on the read path as well, where it is
    // the last line against a row that was written before the signature CHECK
    // existed. The database refuses to store such a signature at all
    // (`relationship_definition_signatures_no_dedicated_hierarchy`), so this is
    // the caller-facing half of a rule the schema holds, not a second source of
    // truth.
    if (
      isDedicatedHierarchyPair(props.sourceEntityType, props.targetEntityType)
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Pair ${props.sourceEntityType}/${props.targetEntityType} is structural hierarchy with its own FK column and must never be stored as a content relationship`,
      );
    }

    // Rules 9 and 10 are deliberately NOT asserted here — do not "restore" this
    // as a standing invariant (rejected at the 7.1 gate, 2026-08-14).
    //
    // Canonical order belongs to the WRITE path: create() produces it and
    // updateNote() cannot touch an endpoint, so no code path in this file can
    // emit a non-canonical aggregate. Re-checking it on the read path would only
    // punish a row that is already wrong, and punish it permanently: Flow 4
    // §Delete step 4 reads the aggregate to obtain `version`, so a row this
    // constructor refuses to build could never be deleted through the API again
    // — in a table with no `content_revisions` history to recover from. Rejecting
    // a row that still carries full meaning ("A related_to B" reads the same
    // either way) over a normalisation technicality is a different class of
    // invariant from Chapter.validate()'s publishedAt rule, which rejects rows
    // that are self-contradictory as business facts.
    //
    // Detecting rows that drifted out of canonical order is a data-audit job.
    // What still has to be guarded, and is NOT covered by the 7.4 dedup test (a
    // swap applied consistently in both directions still dedups correctly): 7.2
    // must prove `ContentRelationshipMapper` round-trips endpoints through
    // toPersistence/toDomain without swapping them.
  }
}
