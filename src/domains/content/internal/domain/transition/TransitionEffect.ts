import {
  isWritableAttributeField,
  writableAttributeFieldsOf,
} from "./attributeFieldRegistry.js";
import {
  NARRATIVE_TRANSITION_SOURCE_TYPES,
  type NarrativeTransitionSourceType,
} from "./NarrativeTransition.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";
import {
  CONTENT_ENTITY_TYPES,
  type ContentEntityType,
} from "../support/ContentRevision.js";
import {
  isDedicatedHierarchyPair,
  isPairAllowedBy,
  type RelationshipDefinition,
} from "../support/relationshipDefinition.js";

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

// The three above state a FACT of their own; the two here act ON one that is
// already in the log (premis §8.3). Kept as two lists rather than one widened
// list, and the split is load-bearing in both directions:
//
//   The narrative transition API may only DECLARE the first three — that is what
//   an author schedules and apply later fulfils. `addEffectSchema` and
//   `transitionResponseSchema` both read `TRANSITION_EFFECT_TYPES`, so keeping
//   it at three is what stops step 4b-2 from silently widening a frozen API.
//
//   The database enum carries all five, so the AGGREGATE has to as well or a
//   row written by one path becomes unreadable by another — which is the shape
//   of bug the mapper's cast used to paper over.
export const ASSERTION_OPERATION_TYPES = ["terminate", "retract"] as const;

export const ASSERTION_LOG_EFFECT_TYPES = [
  ...TRANSITION_EFFECT_TYPES,
  ...ASSERTION_OPERATION_TYPES,
] as const;

export type DeclarableEffectType = (typeof TRANSITION_EFFECT_TYPES)[number];


export type AssertionOperationType = (typeof ASSERTION_OPERATION_TYPES)[number];

// What a row in `transition_effects` may be. `DeclarableEffectType` is the
// narrower name to reach for when the subject really is a Phase 7 effect.
export type TransitionEffectType =
  | DeclarableEffectType
  | AssertionOperationType;

// Which kinds each operation is defined over — the mirror of the CHECK
// constraints `transition_effects_terminate_targets_assertion` and
// `..._retract_targets_assertion_or_terminate`, and mirrored on purpose: the
// database refuses the row, this refuses to BUILD it, and a caller gets a domain
// error naming the rule instead of a constraint-violation stack trace.
//
// Listed positively, exactly as the DDL is, so a future member of the enum is
// refused until someone decides where it belongs rather than admitted by silence.
const TERMINATE_TARGET_TYPES: readonly TransitionEffectType[] =
  TRANSITION_EFFECT_TYPES;

const RETRACT_TARGET_TYPES: readonly TransitionEffectType[] = [
  ...TRANSITION_EFFECT_TYPES,
  "terminate",
];

export type TransitionEffectProperties = {
  id: string;
  // NULL since step 4b: an assertion written straight through relationship CRUD
  // belongs to no transition. The column has been nullable since the 2026-08-18
  // migration (blocker 1) — the aggregate is only catching up, which langkah 2
  // recorded as deliberately deferred
  // (`notes/phase-11-validation.md` §Yang BELUM dikerjakan di langkah 2).
  //
  // One aggregate over the whole log rather than two over one table: a
  // `terminate` may target an assertion written by the OTHER path
  // (`target_assertion_id`, C-1), so that invariant crosses any boundary drawn
  // between the two writers — which is the signal the boundary would be wrong.
  narrativeTransitionId: string | null;
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
  // Blocker 4 of the frozen addendum, and the other half of `has_provenance`:
  // an assertion with no parent transition must say WHICH PREDICATE it asserts.
  // Null for `attribute_change`, which names a field rather than a predicate —
  // and which is why such an effect always needs a transition.
  relationshipDefinitionId: string | null;
  relatedEntityType: ContentEntityType | null;
  relatedEntityId: string | null;

  // VALID TIME — the story moment the fact starts holding at, or (on a
  // `terminate`) stops. Null is a real answer and not a missing one: "holds with
  // no time information", which premis §8.3 distinguishes from "holds at every
  // cut". The pair is all-or-nothing, mirroring the `anchor_complete` CHECK —
  // half an anchor claims a story time it cannot name, and it would fold into
  // the wrong answer silently rather than fail.
  anchorEntityType: NarrativeTransitionSourceType | null;
  anchorEntityId: string | null;

  // Which assertion an operation row acts on, and WHAT KIND that row is. Both
  // present exactly when the row is a `terminate`/`retract`, both absent
  // otherwise — the `target_matches_operation` and `target_kind_complete`
  // CHECKs, restated where a caller gets a sentence instead of a constraint name.
  //
  // The kind is carried rather than looked up for the reason C-1 settled: it is
  // what lets the composite foreign key hold the claim to account, and it cannot
  // drift because `effect_type` is never updated.
  targetAssertionId: string | null;
  targetEffectType: TransitionEffectType | null;

  appliedAt: Date | null;
  contentRevisionId: string | null;
  createdAt: Date;
};

type BaseCreateTransitionEffectProperties = {
  id: string;
  narrativeTransitionId: string | null;
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
// `relationshipType` is a plain `string`, exactly like
// `CreateContentRelationshipProperties.relationType`: an author-owned symbol has
// no compile-time extent. Entity types stay narrowed — those are route
// constants, never free text.
export type CreateTransitionEffectProperties =
  | (BaseCreateTransitionEffectProperties & {
      effectType: "attribute_change";
      fieldPath: string;
      newValue: string;
    })
  | (BaseCreateTransitionEffectProperties & {
      effectType: "relationship_add" | "relationship_remove";
      relationshipType: string;
      // The project's row for `relationshipType`. Required on the DECLARE path
      // for the reason the whole check exists here: an effect that
      // `ContentRelationship.create()` would refuse is an effect that can never
      // be applied, and the caller has to have resolved the predicate anyway to
      // know it exists at all.
      definition: RelationshipDefinition;
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

    // Rules 1 and 3, on the declare path, against the predicate's own definition.
    // Both are the twins of the checks in `ContentRelationship.create()`; what
    // they add here is TIME — refusing at declare rather than at apply, so an
    // effect that could never be applied is never stored as a promise.
    if (props.effectType !== "attribute_change") {
      if (props.definition.predicate !== props.relationshipType) {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          `Definition ${props.definition.predicate} does not describe relation type ${props.relationshipType}`,
        );
      }

      if (!props.definition.objectRequired) {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          `Predicate ${props.relationshipType} takes no object and cannot be stored as a relationship`,
        );
      }

      // Rule 11 before rule 3, the order validate() also uses: both reject the
      // pair, only this one names the mechanism to use instead. Repeated here
      // because rule 3 now runs in create(), ahead of the constructor, and would
      // otherwise pre-empt it with the vaguer message.
      if (
        isDedicatedHierarchyPair(props.targetEntityType, props.relatedEntityType)
      ) {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          `Pair ${props.targetEntityType}/${props.relatedEntityType} is structural hierarchy with its own FK column and must never be stored as a content relationship`,
        );
      }

      // Checked on the endpoints exactly as DECLARED, with no canonicalisation
      // step — and that is a verified claim rather than an omission. Symmetry is
      // expanded by isPairAllowedBy() for non-directional predicates and
      // canonicalisation is the identity for directional ones, so canonicalising
      // first could never change the answer; the call would be a line nothing
      // could falsify.
      //
      // Two consequences worth stating, since the storage decision rests on them:
      //
      //   The effect stores its endpoints as the writer declared them.
      //   `target_entity_*` is indexed as "which entity does this effect touch"
      //   (`16:122-123`, the pending-effects partial index), so swapping the
      //   sides at declaration time would break the query those columns exist
      //   for. The row that apply eventually writes IS canonicalised, by
      //   `ContentRelationship.create()` — that belongs to the row's identity,
      //   not to the intent.
      //
      //   For a DIRECTIONAL predicate the orientation carries meaning, so it is
      //   fixed here: `target_entity_*` is the relationship's SOURCE side and
      //   `related_entity_*` its target side. "Sword owns Prince" is declared
      //   with target=sword, related=prince, and declaring it the other way
      //   round is a different claim, rejected here.
      if (
        !isPairAllowedBy(
          props.definition,
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
      relationshipDefinitionId:
        props.effectType === "attribute_change" ? null : props.definition.id,
      relatedEntityType:
        props.effectType === "attribute_change" ? null : props.relatedEntityType,
      relatedEntityId:
        props.effectType === "attribute_change" ? null : props.relatedEntityId,
      // A declared effect carries no anchor of its own — its story time is its
      // parent transition's — and acts on no other row. Both are what the two
      // named constructors below add, each for its own reason.
      anchorEntityType: null,
      anchorEntityId: null,
      targetAssertionId: null,
      targetEffectType: null,
      // Every effect is born pending. There is no "declare it already applied"
      // path: apply is what writes this column, inside the transaction that
      // performs the mutation (`16:152-182`).
      appliedAt: null,
      contentRevisionId: null,
      createdAt: props.now,
    });
  }

  // A fact stated OUTRIGHT, with no declare/apply cycle — what relationship CRUD
  // writes since step 4b. Separate named constructor rather than a flag on
  // create(), because the two differ in more than one field and the difference
  // is the point: `create()` produces an INTENT that apply later fulfils, this
  // produces a fact that already holds.
  //
  // `appliedAt` is set at creation for that reason. There is no second step that
  // could set it, and a permanently pending row would read as "someone declared
  // this and never applied it" to every query written for the other path.
  //
  // Relationship shapes only: an `attribute_change` cannot be stated this way
  // because it names no predicate, so a parentless one could not say where it
  // came from (validate() refuses it, mirroring the `has_provenance` CHECK).
  static assertFact(
    props: Extract<
      CreateTransitionEffectProperties,
      { effectType: "relationship_add" | "relationship_remove" }
    > & { narrativeTransitionId: null },
  ): TransitionEffect {
    const effect = TransitionEffect.create(props);

    // Through the same factory first, so every rule create() enforces — arity,
    // the pair matrix, hierarchy, self-relationship — is enforced here too and
    // cannot drift apart from it.
    return TransitionEffect.reconstitute({
      ...effect.toSnapshot(),
      appliedAt: props.now,
    });
  }

  // A CLAIM WITHDRAWN — "this was never true, at any cut" (premis §8.3,
  // transaction time). Step 4b-2: what `DELETE /relationships/:id` writes instead
  // of destroying the row.
  //
  // WHY `retract` AND NOT `terminate`, since the two are easy to swap by
  // accident: the CRUD button is destructive today and says nothing about story
  // time, which is exactly `retract`'s meaning. Mapping it to `terminate` would
  // change what the button MEANS while claiming to preserve it, and would produce
  // a valid-time row with a NULL anchor — a termination whose "when" no reader
  // can ever answer. Termination belongs to an action that can name a story
  // moment (7.7's `relationship_remove` has one through its parent), which is why
  // no `terminateFact()` is added here: there is no caller for it yet, and premis
  // §8.3 asks the UI to offer the two as SEPARATE actions rather than guessing.
  //
  // TAKES THE TARGET AGGREGATE, not its id. The kind of the target is the whole
  // question C-1 was about, and reading it off the row removes the one way this
  // could go wrong — a caller passing a kind it merely believes. Same-project is
  // checked here for the same reason: the composite FK would refuse it anyway,
  // and a domain error naming the tenancy beats a constraint violation.
  static retractFact(props: {
    id: string;
    projectId: string;
    // The row being withdrawn. `relationship_add` in every current caller, but
    // deliberately not narrowed to it: `retract` is defined over any FACT and
    // over `terminate` too, and narrowing here would put the enum's future in
    // this signature instead of in RETRACT_TARGET_TYPES.
    target: TransitionEffect;
    // Provenance, and it must be present: this row has no parent transition, so
    // `has_provenance` is satisfied only by naming the predicate whose claim is
    // being withdrawn. Handed in rather than read off the target so the caller
    // has to have resolved it — the same rule the declare path follows.
    definition: RelationshipDefinition;
    now: Date;
  }): TransitionEffect {
    if (props.target.projectId !== props.projectId) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Cannot retract an assertion belonging to another project",
      );
    }

    // The predicate must be THE target's, and the target names it in one of two
    // ways depending on how it was written. Comparing only the definition id
    // silently refuses every row whose provenance is its parent transition
    // instead of a definition — a whole legitimate class, and the one 7.7 writes.
    if (props.target.relationshipDefinitionId !== null) {
      if (props.definition.id !== props.target.relationshipDefinitionId) {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          "Retraction names a different predicate than the assertion it withdraws",
        );
      }
    } else if (props.target.relationshipType !== null) {
      // Provenance came from the parent transition, so the predicate is a NAME
      // here rather than a row pointer. Matching on the name is weaker than
      // matching on the id — the definition could have been renamed since — and
      // that is the honest limit rather than a check to skip.
      if (props.definition.predicate !== props.target.relationshipType) {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          "Retraction names a different predicate than the assertion it withdraws",
        );
      }
    } else {
      // Reachable only for a target that names no predicate at all: an
      // `attribute_change`, or an operation row whose provenance is entirely its
      // parent transition. Such a retraction cannot state provenance of its own,
      // and `has_provenance` needs one, so it must be declared INSIDE a
      // transition instead. Refused here with the reason, because the shape that
      // would serve it — a retraction that inherits its target's parent — is a
      // decision for 4b-3, when `relationship_remove` starts terminating.
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Cannot retract a row that names no predicate: such a retraction has no provenance of its own and must belong to a narrative transition",
      );
    }

    // The subject travels with the retraction rather than being left to a join.
    // `target_entity_*` is NOT NULL in the table, and the honest value is the
    // subject of the claim being withdrawn — the same entity the assertion is
    // indexed under, so "every row touching this entity" keeps returning the
    // withdrawal alongside the claim.
    return TransitionEffect.reconstitute({
      id: props.id,
      narrativeTransitionId: null,
      projectId: props.projectId,
      effectType: "retract",
      targetEntityType: props.target.targetEntityType,
      targetEntityId: props.target.targetEntityId,
      fieldPath: null,
      newValue: null,
      // The operation does not RESTATE the fact — it points at it. Repeating the
      // endpoints here would create a second copy of the claim that could
      // disagree with the row it withdraws.
      relationshipType: null,
      relationshipDefinitionId: props.definition.id,
      relatedEntityType: null,
      relatedEntityId: null,
      // No anchor, and this is the line that separates the two operations: a
      // retraction is not placed in story time at all. `terminate` is where an
      // anchor belongs.
      anchorEntityType: null,
      anchorEntityId: null,
      targetAssertionId: props.target.id,
      targetEffectType: props.target.effectType,
      // In force the moment it is written, like `assertFact()`: there is no
      // second step that could set this, and a pending row would read as
      // "someone declared this and never applied it".
      appliedAt: props.now,
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

  get narrativeTransitionId(): string | null {
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

  // Exposed since step 4b-2: an operation row must be able to check that the
  // predicate it names is the one the target actually asserts, and the target is
  // handed in as an aggregate rather than as a row.
  get relationshipDefinitionId(): string | null {
    return this.props.relationshipDefinitionId;
  }

  get relatedEntityType(): ContentEntityType | null {
    return this.props.relatedEntityType;
  }

  get relatedEntityId(): string | null {
    return this.props.relatedEntityId;
  }

  get anchorEntityType(): NarrativeTransitionSourceType | null {
    return this.props.anchorEntityType;
  }

  get anchorEntityId(): string | null {
    return this.props.anchorEntityId;
  }

  get targetAssertionId(): string | null {
    return this.props.targetAssertionId;
  }

  get targetEffectType(): TransitionEffectType | null {
    return this.props.targetEffectType;
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

    // Blank is still refused, null is not: blank means a caller had a parent and
    // lost it, null means there never was one. Only the first is corruption.
    if (
      props.narrativeTransitionId !== null &&
      props.narrativeTransitionId.trim() === ""
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Narrative transition id must not be blank",
      );
    }

    // Twin of the `transition_effects_has_provenance` CHECK: every row must be
    // able to answer "where did this fact come from", and there are exactly two
    // valid answers — a transition, or the predicate it asserts. An
    // `attribute_change` names no predicate (it carries `field_path` + value),
    // so a parentless one could answer neither.
    if (
      props.narrativeTransitionId === null &&
      props.effectType === "attribute_change"
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "An attribute change must belong to a narrative transition",
      );
    }

    // The general form of the same CHECK, which the branch above is only one
    // corner of. Since step 4b-2 a row can be parentless AND carry no predicate
    // — an operation row built without its definition — and that row answers
    // neither "who claimed it" nor "what does it claim".
    if (
      props.narrativeTransitionId === null &&
      props.relationshipDefinitionId === null
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "An effect must belong to a narrative transition or name a relationship definition",
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

      case "terminate":
      case "retract":
        TransitionEffect.validateAssertionOperation(props);
        break;

      default: {
        const exhaustiveCheck: never = props.effectType;
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          `Invalid transition effect type: ${String(exhaustiveCheck)}`,
        );
      }
    }

    TransitionEffect.validateAnchor(props);
    TransitionEffect.validateTargeting(props);
    TransitionEffect.validateAppliedState(props);
  }

  // `anchor_complete`, and it applies to every row rather than to one variant:
  // an assertion may carry a story anchor, an operation may carry its own, and a
  // declared effect carries none. What none of them may be is HALF anchored.
  private static validateAnchor(props: TransitionEffectProperties): void {
    if ((props.anchorEntityType === null) !== (props.anchorEntityId === null)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "An anchor must be a complete (type, id) pair or absent entirely",
      );
    }

    if (props.anchorEntityId !== null && props.anchorEntityId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Anchor entity id must not be blank",
      );
    }

    if (
      props.anchorEntityType !== null &&
      !NARRATIVE_TRANSITION_SOURCE_TYPES.includes(props.anchorEntityType)
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid anchor entity type",
      );
    }
  }

  // The three targeting CHECKs, in the order they answer three different
  // questions: does this row point at another one, WHAT KIND is that row, and is
  // that kind one this operation is defined over.
  private static validateTargeting(props: TransitionEffectProperties): void {
    const isOperation =
      props.effectType === "terminate" || props.effectType === "retract";

    // `target_matches_operation`, written as the same equivalence the DDL uses so
    // neither direction can be relaxed without the other: an operation with no
    // target is meaningless, and a FACT that points at another row is claiming a
    // relationship between claims that this table does not model.
    if (isOperation !== (props.targetAssertionId !== null)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        isOperation
          ? `A ${props.effectType} must name the assertion it acts on`
          : `A ${props.effectType} must not point at another assertion`,
      );
    }

    // `target_kind_complete`. Without it the allowlist below would be vacuously
    // true for a row whose target kind went unstated — the exact way C-1 hid.
    if ((props.targetAssertionId === null) !== (props.targetEffectType === null)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "A target assertion and its effect type must be present together",
      );
    }

    if (props.targetAssertionId === null || props.targetEffectType === null) {
      return;
    }

    if (props.targetAssertionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Target assertion id must not be blank",
      );
    }

    // `target_not_self`. Longer cycles are neither checkable here nor
    // expressible: both operations point BACKWARD at a row that already existed.
    if (props.targetAssertionId === props.id) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "An effect cannot terminate or retract itself",
      );
    }

    // The two kind allowlists (premis §8.3 AMENDMENT). `terminate` ends the valid
    // range of a FACT, and an operation has no range to end; `retract` may
    // withdraw a fact OR a `terminate` — the only escape from a mistyped
    // termination in an append-only log — but never another `retract`, which
    // would be double negation and would force retractions to be resolved
    // transitively.
    const allowed =
      props.effectType === "terminate"
        ? TERMINATE_TARGET_TYPES
        : RETRACT_TARGET_TYPES;

    if (!allowed.includes(props.targetEffectType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `A ${props.effectType} is not defined over a ${props.targetEffectType} row`,
      );
    }
  }

  // An operation row points at a fact; it does not restate one. Carrying either
  // variant's payload would put a second copy of the claim in the log, free to
  // disagree with the row it acts on.
  private static validateAssertionOperation(
    props: TransitionEffectProperties,
  ): void {
    if (props.fieldPath !== null || props.newValue !== null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `A ${props.effectType} must not carry attribute change fields`,
      );
    }

    if (
      props.relationshipType !== null ||
      props.relatedEntityType !== null ||
      props.relatedEntityId !== null
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `A ${props.effectType} must not restate the fact it acts on`,
      );
    }
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

    // From here down the rules belong to the predicate's definition, not to this
    // file, and only the two that need no definition row are still checked here.
    // Every check below has a twin in `../support/ContentRelationship.ts`, and
    // the twin is what actually guards the table; this pair only moves the
    // rejection from apply time to declare time — an effect that create() would
    // refuse is a promise the system already knows it cannot keep.
    //
    // Rules 1 and 3 moved to create() in step 4 for the reason spelled out in
    // `ContentRelationship.validate()`: answering them requires the project's
    // definition rows, and reconstitute() has none.

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

    // Rule 11. Needs no definition row — it reads only the two entity types — so
    // unlike rules 1 and 3 it stays on the read path too.
    if (
      isDedicatedHierarchyPair(props.targetEntityType, props.relatedEntityType)
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Pair ${props.targetEntityType}/${props.relatedEntityType} is structural hierarchy with its own FK column and must never be stored as a content relationship`,
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
