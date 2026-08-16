import {
  isWritableAttributeField,
  writableAttributeFieldsOf,
} from "./attributeFieldRegistry.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";
import {
  CONTENT_ENTITY_TYPES,
  type ContentEntityType,
} from "../support/ContentRevision.js";
import {
  isDedicatedHierarchyPair,
  isPairAllowed,
  isRelationType,
} from "../support/relationTypeRegistry.js";

// One intended consequence of a narrative transition, on one entity
// (`transition_effects`, `prisma/narrative-transition.prisma:38-60`). Flow 10
// (`02-system-design/03_flow_10_narrative_transition.md`) plus
// `03-database-design/16_narrative_transition_tables.md:90-127`.
//
// The table is a THREE-VARIANT UNION in one row shape: `attribute_change` uses
// `field_path` + `new_value`, the two `relationship_*` types use
// `relationship_type` + `related_entity_*`, and every one of those columns is
// nullable because the other variant does not need it. The only CHECK the
// database carries is on `effect_type` itself (`:111`); per-variant completeness
// is explicitly left to the application layer (`:112-116`). That is what this
// entity is for. A service-level check would not have been enough — 7.7 is not
// the only writer this table will ever have, and an invariant that lives in a
// service does not travel to the next one (same reasoning as
// `../support/ContentRelationship.ts:20-27`).
//
// INTENT ONLY. There is no `old_value` column and no `before` snapshot here by
// design (keputusan #5, `notes/NARRATIVE_TRANSITION_DRAFT.md:90-98`): between
// declaration and apply the entity may have moved, so the actual before/after is
// whatever `ContentRevision` records at apply time. `new_value` is what the
// writer INTENDED, not a claim about the world.
//
// APPEND-ONLY. `applied_at` goes null → timestamp exactly once and never back
// (`05-implementation-policy/05_append_only_invariants.md:52-64`). markApplied()
// below refuses the second call, but that refusal is a backstop, not the
// mechanism: an already-applied effect must be detected by the service under the
// `FOR UPDATE` lock and answered as an idempotent no-op, never by catching this
// error (`flow_10:101,115`).
export const TRANSITION_EFFECT_TYPES = [
  "attribute_change",
  "relationship_add",
  "relationship_remove",
] as const;

export type TransitionEffectType = (typeof TRANSITION_EFFECT_TYPES)[number];

export type TransitionEffectProperties = {
  id: string;
  narrativeTransitionId: string;
  // Denormalised from the parent transition, with no FK of its own — the parent
  // already points at `projects` (`16:95,127`, same shape as `issue_targets` in
  // the Validation domain). Whoever inserts sets it from the parent; this entity
  // cannot verify the two agree, because the parent is a different aggregate.
  projectId: string;
  effectType: TransitionEffectType;
  targetEntityType: ContentEntityType;
  targetEntityId: string;
  fieldPath: string | null;
  newValue: string | null;
  relationshipType: string | null;
  relatedEntityType: ContentEntityType | null;
  relatedEntityId: string | null;
  appliedAt: Date | null;
  contentRevisionId: string | null;
  createdAt: Date;
};

type BaseCreateTransitionEffectProperties = {
  id: string;
  narrativeTransitionId: string;
  projectId: string;
  targetEntityType: ContentEntityType;
  targetEntityId: string;
  now: Date;
};

// Discriminated union, same device as `CreateContentRevisionProperties`
// (`../support/ContentRevision.ts:54-67`): the caller cannot even express
// "attribute change with a relationship type" — it fails to compile before
// validate() ever runs. validate() still repeats the check, because
// reconstitute() is how a hand-edited or drifted row gets back in.
//
// `relationshipType` is a plain `string` rather than `RelationType`, exactly like
// `CreateContentRelationshipProperties.relationType`
// (`../support/ContentRelationship.ts:48-54`): the wire value arrives
// unnarrowed and the domain owns the rejection, so both entry paths get the same
// answer. Entity types stay narrowed — those are route constants, never free
// text.
export type CreateTransitionEffectProperties =
  | (BaseCreateTransitionEffectProperties & {
      effectType: "attribute_change";
      fieldPath: string;
      newValue: string;
    })
  | (BaseCreateTransitionEffectProperties & {
      effectType: "relationship_add" | "relationship_remove";
      relationshipType: string;
      relatedEntityType: ContentEntityType;
      relatedEntityId: string;
    });

// `contentRevisionId` is required for `attribute_change` and forbidden for the
// relationship variants: a relationship change produces no `ContentRevision` at
// all (`16:105`, `flow_10:117`), so a pointer there would be a lie about
// provenance rather than a harmless extra.
export type MarkTransitionEffectAppliedProperties = {
  contentRevisionId?: string | null;
  now: Date;
};

export class TransitionEffect {
  private constructor(private readonly props: TransitionEffectProperties) {
    TransitionEffect.validate(props);
  }

  static create(props: CreateTransitionEffectProperties): TransitionEffect {
    // Rule that lives on the WRITE path only, and deliberately not in
    // validate() — same split `ContentRelationship` makes for canonical order
    // (`../support/ContentRelationship.ts:333-353`). The relation type registry
    // is frozen in a policy document, so validate() may enforce it on the read
    // path; the writable-field allowlist is a Phase 7 decision over columns that
    // will keep changing, and enforcing it on the read path would mean that
    // narrowing the allowlist later turns every effect already declared against
    // a removed field into a row that can no longer be READ — and therefore no
    // longer deleted either, since deleting one requires reading `applied_at`
    // first. Apply re-checks it (decision D3), so a field that stops being
    // writable stops being appliable without trapping anything.
    if (
      props.effectType === "attribute_change" &&
      !isWritableAttributeField(props.targetEntityType, props.fieldPath)
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Field ${props.fieldPath} is not writable by a narrative transition on ${props.targetEntityType}. Writable fields: ${writableAttributeFieldsOf(props.targetEntityType).join(", ")}`,
      );
    }

    return new TransitionEffect({
      id: props.id,
      narrativeTransitionId: props.narrativeTransitionId,
      projectId: props.projectId,
      effectType: props.effectType,
      targetEntityType: props.targetEntityType,
      targetEntityId: props.targetEntityId,
      fieldPath: props.effectType === "attribute_change" ? props.fieldPath : null,
      // Stored verbatim, not trimmed or normalised: the target aggregate's own
      // updateDetails() decides what a value means for its field (Event trims
      // its title, `normalizeOptionalText` empties blank optionals), and doing
      // half of that here would produce a stored intent that differs from what
      // apply eventually writes.
      newValue: props.effectType === "attribute_change" ? props.newValue : null,
      relationshipType:
        props.effectType === "attribute_change" ? null : props.relationshipType,
      relatedEntityType:
        props.effectType === "attribute_change" ? null : props.relatedEntityType,
      relatedEntityId:
        props.effectType === "attribute_change" ? null : props.relatedEntityId,
      // Every effect is born pending. There is no "declare it already applied"
      // path: apply is what writes this column, inside the transaction that
      // performs the mutation (`16:152-182`).
      appliedAt: null,
      contentRevisionId: null,
      createdAt: props.now,
    });
  }

  static reconstitute(props: TransitionEffectProperties): TransitionEffect {
    return new TransitionEffect(props);
  }

  get id(): string {
    return this.props.id;
  }

  get narrativeTransitionId(): string {
    return this.props.narrativeTransitionId;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get effectType(): TransitionEffectType {
    return this.props.effectType;
  }

  get targetEntityType(): ContentEntityType {
    return this.props.targetEntityType;
  }

  get targetEntityId(): string {
    return this.props.targetEntityId;
  }

  get fieldPath(): string | null {
    return this.props.fieldPath;
  }

  get newValue(): string | null {
    return this.props.newValue;
  }

  get relationshipType(): string | null {
    return this.props.relationshipType;
  }

  get relatedEntityType(): ContentEntityType | null {
    return this.props.relatedEntityType;
  }

  get relatedEntityId(): string | null {
    return this.props.relatedEntityId;
  }

  get appliedAt(): Date | null {
    return this.props.appliedAt;
  }

  get contentRevisionId(): string | null {
    return this.props.contentRevisionId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  // The append-only guard reads this, in two places that must not be confused:
  // the service refuses to DELETE an applied effect (409, `05_append_only_
  // invariants.md:56-59`), and it returns an idempotent no-op instead of
  // applying twice. Deleting a row is a repository act, so no method here can
  // prevent it — this getter is the whole of what the domain can offer, and the
  // guard itself belongs to whoever calls the repository.
  get isApplied(): boolean {
    return this.props.appliedAt !== null;
  }

  // Returns nothing rather than a boolean, unlike ContentRelationship.updateNote:
  // a second apply is not a no-op to be reported, it is a state this aggregate
  // must never reach. The service is expected to have checked isApplied under
  // the row lock already; reaching this throw means that check was skipped.
  markApplied(input: MarkTransitionEffectAppliedProperties): void {
    if (this.isApplied) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Transition effect is already applied and cannot be applied again",
      );
    }

    const nextProperties: TransitionEffectProperties = {
      ...this.props,
      appliedAt: input.now,
      contentRevisionId: input.contentRevisionId ?? null,
    };

    TransitionEffect.validate(nextProperties);

    Object.assign(this.props, nextProperties);
  }

  toSnapshot(): TransitionEffectProperties {
    return { ...this.props };
  }

  private static validate(props: TransitionEffectProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Transition effect id is required",
      );
    }

    if (props.narrativeTransitionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Narrative transition id is required",
      );
    }

    if (props.projectId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project id is required",
      );
    }

    // Opaque cross-aggregate token, same treatment as Scene.chapterId and both
    // relationship endpoints: whether the row exists, is of this type, and lives
    // in this project can only be answered by that entity's own row, and the
    // service does it before create() is ever called (Flow 10 step 4).
    if (props.targetEntityId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Target entity id is required",
      );
    }

    // Defence in depth for a value cast past the union. Both entity type columns
    // are Postgres enums (`narrative-transition.prisma:43,48`), so this can only
    // fire on a caller that lied to the compiler — and it reads the one canonical
    // list rather than repeating the nine values a third time
    // (`../support/ContentRevision.ts:11-21`).
    if (!CONTENT_ENTITY_TYPES.includes(props.targetEntityType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid target entity type",
      );
    }

    switch (props.effectType) {
      case "attribute_change":
        TransitionEffect.validateAttributeChange(props);
        break;

      case "relationship_add":
      case "relationship_remove":
        TransitionEffect.validateRelationshipChange(props);
        break;

      default: {
        const exhaustiveCheck: never = props.effectType;
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          `Invalid transition effect type: ${String(exhaustiveCheck)}`,
        );
      }
    }

    TransitionEffect.validateAppliedState(props);
  }

  private static validateAttributeChange(
    props: TransitionEffectProperties,
  ): void {
    if (props.fieldPath === null || props.fieldPath.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Attribute change effect requires a field path",
      );
    }

    // `new_value` is NOT NULL for this variant (`16:112-113`), so "clear this
    // field" is not expressible through a transition — a deliberate limit, not
    // an oversight: a null here would be indistinguishable from the other two
    // variants' null, and the column carries no marker to tell them apart.
    if (props.newValue === null || props.newValue.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Attribute change effect requires a new value",
      );
    }

    if (
      props.relationshipType !== null ||
      props.relatedEntityType !== null ||
      props.relatedEntityId !== null
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Attribute change effect must not carry relationship fields",
      );
    }
  }

  private static validateRelationshipChange(
    props: TransitionEffectProperties,
  ): void {
    if (props.fieldPath !== null || props.newValue !== null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Relationship effect must not carry attribute change fields",
      );
    }

    if (props.relationshipType === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Relationship effect requires a relationship type",
      );
    }

    if (props.relatedEntityType === null || props.relatedEntityId === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Relationship effect requires a related entity",
      );
    }

    if (props.relatedEntityId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Related entity id is required",
      );
    }

    if (!CONTENT_ENTITY_TYPES.includes(props.relatedEntityType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid related entity type",
      );
    }

    // From here down the rules are the registry's, not this file's, and they are
    // enforced HERE rather than deferred to apply for one reason: an effect that
    // `ContentRelationship.create()` would refuse is an effect that can never be
    // applied — declaring it means storing a promise the system already knows it
    // cannot keep. Every check below has a twin in
    // `../support/ContentRelationship.ts`, and the twin is what actually guards
    // the table; this pair only moves the rejection from apply time to declare
    // time.
    //
    // `relationship_type` is plain TEXT here too (`16:101`), so rule 1 is the
    // only thing between the column and free text.
    if (!isRelationType(props.relationshipType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Unknown relation type: ${props.relationshipType}`,
      );
    }

    // Rule 4. Both halves must match: the same id under a different entity type
    // is a different entity.
    if (
      props.targetEntityType === props.relatedEntityType &&
      props.targetEntityId === props.relatedEntityId
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Self-relationship is not allowed: target and related entity are the same",
      );
    }

    // Rule 11, before rule 3 for the same reason ContentRelationship orders them
    // that way: both reject the pair, only this one names the mechanism to use
    // instead.
    if (
      isDedicatedHierarchyPair(props.targetEntityType, props.relatedEntityType)
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Pair ${props.targetEntityType}/${props.relatedEntityType} is structural hierarchy with its own FK column and must never be stored as a content relationship`,
      );
    }

    // Rule 3, checked on the endpoints exactly as declared — no canonicalisation
    // step here, and that is a verified claim rather than an omission: a first
    // draft canonicalised first, and mutating the check to skip it turned no test
    // red, because `ALLOWED_PAIR_KEYS` already stores both orientations for every
    // non-directional type (`../support/relationTypeRegistry.ts:445-447`) and
    // canonicalisation is the identity for directional ones
    // (`:494-503`). Canonicalising before this call could therefore never change
    // the answer; keeping the call would have been a line nothing could falsify.
    //
    // Two consequences worth stating, since they are what the storage decision
    // rests on:
    //
    //   The effect stores its endpoints as the writer declared them.
    //   `target_entity_*` is indexed as "which entity does this effect touch"
    //   (`16:122-123`, the pending-effects partial index), so swapping the sides
    //   at declaration time would break the query those columns exist for. The
    //   row that apply eventually writes IS canonicalised, by
    //   `ContentRelationship.create()` — that belongs to the row's identity, not
    //   to the intent.
    //
    //   For a DIRECTIONAL type the orientation carries meaning, so it is fixed
    //   here: `target_entity_*` is the relationship's SOURCE side and
    //   `related_entity_*` its target side. "Sword owns Prince" is declared with
    //   target=sword, related=prince, and declaring it the other way round is a
    //   different claim, rejected below.
    if (
      !isPairAllowed(
        props.relationshipType,
        props.targetEntityType,
        props.relatedEntityType,
      )
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Relation type ${props.relationshipType} does not allow the pair ${props.targetEntityType} -> ${props.relatedEntityType}`,
      );
    }
  }

  private static validateAppliedState(
    props: TransitionEffectProperties,
  ): void {
    if (props.contentRevisionId !== null && props.contentRevisionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Content revision id must not be blank",
      );
    }

    // A pending effect has produced nothing yet, so it cannot point at a
    // revision. This is the pairing the soft pointer needs most: the column has
    // no FK (`16:105,117` — ContentRevision stays frozen and gains no back-ref),
    // so nothing below this layer will ever notice an incoherent pair.
    if (props.appliedAt === null && props.contentRevisionId !== null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Pending transition effect must not reference a content revision",
      );
    }

    if (props.effectType !== "attribute_change") {
      if (props.contentRevisionId !== null) {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          "Relationship effect must not reference a content revision",
        );
      }

      return;
    }

    // The converse, and the one that keeps the state-evolution join honest: an
    // applied attribute change without its revision pointer is a row that claims
    // an entity was mutated while leaving no trace of before/after — the join in
    // `16:191-200` would simply not see it, and the causal history it produces
    // would be silently incomplete.
    if (props.appliedAt !== null && props.contentRevisionId === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Applied attribute change effect requires a content revision id",
      );
    }
  }
}
