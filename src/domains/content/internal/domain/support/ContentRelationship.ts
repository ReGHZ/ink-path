import {
  canonicalizeEndpoints,
  isDedicatedHierarchyPair,
  isPairAllowed,
  isRelationType,
  type RelationEndpoint,
  type RelationType,
} from "./relationTypeRegistry.js";
import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

import type { ContentEntityType } from "./ContentRevision.js";

// M:N relationship between two content entities (`content_relationships`,
// `ink-path/prisma/content-support.prisma:55-81`). Flow 4
// (`02-system-design/03_flow_04_content_relationship.md`) plus the 12 validation
// rules of `05-implementation-policy/02_relation_type_registry.md` §4.
//
// Rules 1, 3, 4 and 11 live in validate(), rules 9 and 10 in create() (write
// path only — see the note at the end of validate()), rule 12 is structural;
// 5, 6, 7 and 8 (endpoint existence, same project, permission) need a repository
// or a membership context and stay in RelationshipService. The split is not
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
  relationType: RelationType;
  note: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// `relationType` is a plain `string` here, not `RelationType`, while every other
// closed set in this domain is narrowed at the type level (compare
// `ContentRevision.CreateContentRevisionProperties.entityType`). Deliberate:
// Rule 1 is the domain's own responsibility, so the wire value may be handed in
// unnarrowed and both entry paths — RelationshipService and 7.7 — get the same
// rejection. Entity types stay unions because they arrive as route constants,
// never as free text (registry §4 rule 2).
export type CreateContentRelationshipProperties = {
  id: string;
  projectId: string;
  relationType: string;
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
    // Rule 1 runs here as well as in validate(), and not redundantly:
    // canonicalizeEndpoints() below needs a narrowed RelationType to know the
    // type's directionality, so an unknown type has to be refused before
    // canonicalization can even be attempted. validate() repeats the check for
    // the reconstitute() path.
    if (!isRelationType(props.relationType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Unknown relation type: ${props.relationType}`,
      );
    }

    const relationType: RelationType = props.relationType;

    // Rules 9 and 10. Canonicalization happens before construction because the
    // canonical orientation IS the stored row's identity (registry §7.4): it is
    // what makes `A↔B` and `B↔A` collide on the unique index, which is how
    // duplicates are detected without any read-before-write (Flow 4 step 8,
    // superseded 2026-08-14). Directional types are returned untouched, so
    // `A -> B` and `B -> A` remain two legitimate relationships.
    const { source, target } = canonicalizeEndpoints(
      relationType,
      props.source,
      props.target,
    );

    return new ContentRelationship({
      id: props.id,
      version: 0,
      projectId: props.projectId,
      sourceEntityType: source.entityType,
      sourceEntityId: source.entityId,
      targetEntityType: target.entityType,
      targetEntityId: target.entityId,
      relationType,
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

  get relationType(): RelationType {
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

    // Rule 1. Repeated from create() because reconstitute() is the path a
    // corrupted or hand-edited row arrives through, and `relation_type` is a
    // plain TEXT column with no enum and no CHECK constraint
    // (`20260711000100_init_schema`) — this file and the registry are the only
    // things standing between that column and free text.
    if (!isRelationType(props.relationType)) {
      const unknownRelationType: never = props.relationType;

      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Unknown relation type: ${String(unknownRelationType)}`,
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

    // Rule 11, checked before Rule 3 on purpose: both would reject these pairs,
    // but only this one can tell the caller WHICH mechanism to use instead. The
    // registry already refuses to contain such a pair at module load
    // (`relationTypeRegistry.ts:414-425`), so this is the caller-facing half of
    // the same rule, not a second source of truth.
    if (
      isDedicatedHierarchyPair(props.sourceEntityType, props.targetEntityType)
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Pair ${props.sourceEntityType}/${props.targetEntityType} is structural hierarchy with its own FK column and must never be stored as a content relationship`,
      );
    }

    // Rule 3.
    //
    // Rule 2 (unknown entity type) has no check of its own, and not merely
    // because rule 3 happens to catch it: `source_entity_type` and
    // `target_entity_type` are Postgres ENUM columns
    // (`content-support.prisma:61-64`), so a row carrying an entity type outside
    // the closed set cannot exist in the database in the first place, and the TS
    // union closes the same door on the caller's side. That is a different class
    // of protection from `relation_type`, which is plain TEXT with no CHECK and
    // therefore needs the explicit rule 1 above. What rule 3 adds is defence in
    // depth for a value cast past the union — it can never be a member of any
    // allowed pair set. Hence no third copy of the nine `ContentEntityType`
    // values; registry §4 rule 2 keeps that list in exactly one place
    // (`ContentRevision.ts:5-15`).
    if (
      !isPairAllowed(
        props.relationType,
        props.sourceEntityType,
        props.targetEntityType,
      )
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Relation type ${props.relationType} does not allow the pair ${props.sourceEntityType} -> ${props.targetEntityType}`,
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
