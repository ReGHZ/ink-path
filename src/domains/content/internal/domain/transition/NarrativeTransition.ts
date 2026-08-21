import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

import type { Assertion } from "./Assertion.js";
import type { ContentEntityType } from "../support/ContentRevision.js";

// Event-centric record of a change in the story world: "in this scene, X
// happened" (`narrative_transitions`, `prisma/narrative-transition.prisma:13-36`).
// Aggregate root over 1:N Assertion (`16:42-52`).
//
// It is NOT the cause. The cause is a Scene, Event or Chapter that already
// exists; this row records the consequences of it (keputusan #3,
// `notes/NARRATIVE_TRANSITION_DRAFT.md:54-78`). Nor is it a content entity: no
// `current_revision_id`, no Qdrant indexing, no `content_relationships` endpoint
// (keputusan #9, `DRAFT:133-135`) — which is why it lives in its own domain
// sub-area rather than beside ContentRelationship and ContentRevision in
// `../support/`.
//
// Why the three source types and not all nine: this is a writing tool, not a
// simulation. Nothing happens in the world unless the writer writes it, and the
// writer writes it in a Scene, in the Chapter when scenes have not been split
// out yet, or as an Event. A Layer or a Map is what gets AFFECTED — a target,
// never a cause (`DRAFT:68-78`).
export const NARRATIVE_TRANSITION_SOURCE_TYPES = [
  "scene",
  "event",
  "chapter",
] as const satisfies readonly ContentEntityType[];

// A strict subset of ContentEntityType, and typed as one on purpose: a source
// type that is not a content entity type could never be resolved by
// `ContentEntityLocator`, which the service uses to check the source exists and
// belongs to the project (Flow 10 §Declare step 5).
export type NarrativeTransitionSourceType =
  (typeof NARRATIVE_TRANSITION_SOURCE_TYPES)[number];

// Derived, never stored — there is no `status` column, and adding one was
// rejected explicitly (keputusan #7, `DRAFT:112-123`): a stored status has to be
// kept in sync with every child on every apply, and an enum with a lifecycle is
// how a tracking mechanism turns into a workflow engine.
//
// Kept as a const tuple with the type derived from it, like every other closed
// vocabulary in this domain (`TRANSITION_EFFECT_TYPES`, `CONTENT_ENTITY_TYPES`,
// `NARRATIVE_TRANSITION_SOURCE_TYPES`): the response DTO needs the three values
// at RUNTIME to build its Zod enum, and a type alone would have forced them to
// be retyped there — a second list to forget, which is the drift D1 refuses.
export const NARRATIVE_TRANSITION_STATUSES = [
  "declared",
  "partially_applied",
  "fully_applied",
] as const;

export type NarrativeTransitionStatus =
  (typeof NARRATIVE_TRANSITION_STATUSES)[number];

// A transition with no assertions at all is `declared`, not `fully_applied`: the
// "every assertion is applied" reading of an empty set is vacuously true and
// exactly wrong here — nothing has happened to the world yet. The doc states the
// three cases in the same order and with the same bias (`16:71-75`).
export function deriveNarrativeTransitionStatus(
  assertions: readonly Assertion[],
): NarrativeTransitionStatus {
  const appliedCount = assertions.filter((assertion) => assertion.isApplied).length;

  if (appliedCount === 0) {
    return "declared";
  }

  return appliedCount === assertions.length ? "fully_applied" : "partially_applied";
}

export type NarrativeTransitionProperties = {
  id: string;
  projectId: string;
  sourceEntityType: NarrativeTransitionSourceType;
  sourceEntityId: string;
  title: string;
  description: string | null;
  declaredByUserId: string;
  reversesTransitionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateNarrativeTransitionProperties = {
  id: string;
  projectId: string;
  sourceEntityType: NarrativeTransitionSourceType;
  sourceEntityId: string;
  title: string;
  description?: string | null;
  declaredByUserId: string;
  reversesTransitionId?: string | null;
  now: Date;
};

// Only the human labels are mutable. The source entity, the reversal link and
// the declaring user are the row's factual content and are set once: changing
// which scene caused a transition after its assertions were applied would rewrite
// causality that `ContentRevision` rows already point back at.
//
// Note there is no `version` column on this table
// (`prisma/narrative-transition.prisma:13-36`), so this update is
// last-write-wins by design. Acceptable for a title and a description; it is
// also the reason no state may ever be moved into this method — `applied_at`
// lives on the child, under a row lock, precisely because state needs the guard
// that this aggregate does not have.
export type UpdateNarrativeTransitionDetailsProperties = {
  title?: string;
  description?: string | null;
  now: Date;
};

export class NarrativeTransition {
  private constructor(private readonly props: NarrativeTransitionProperties) {
    NarrativeTransition.validate(props);
  }

  static create(
    props: CreateNarrativeTransitionProperties,
  ): NarrativeTransition {
    return new NarrativeTransition({
      id: props.id,
      projectId: props.projectId,
      sourceEntityType: props.sourceEntityType,
      sourceEntityId: props.sourceEntityId,
      title: props.title.trim(),
      description: normalizeOptionalText(props.description ?? null),
      declaredByUserId: props.declaredByUserId,
      reversesTransitionId: props.reversesTransitionId ?? null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(
    props: NarrativeTransitionProperties,
  ): NarrativeTransition {
    return new NarrativeTransition(props);
  }

  get id(): string {
    return this.props.id;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get sourceEntityType(): NarrativeTransitionSourceType {
    return this.props.sourceEntityType;
  }

  get sourceEntityId(): string {
    return this.props.sourceEntityId;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string | null {
    return this.props.description;
  }

  get declaredByUserId(): string {
    return this.props.declaredByUserId;
  }

  get reversesTransitionId(): string | null {
    return this.props.reversesTransitionId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // Returns false when nothing changed, like every Phase 4-6 updateDetails(): a
  // no-op PATCH then skips the repository call entirely instead of bumping
  // `updated_at` for nothing.
  updateDetails(input: UpdateNarrativeTransitionDetailsProperties): boolean {
    const nextProperties: NarrativeTransitionProperties = { ...this.props };

    let changed = false;

    if (input.title !== undefined) {
      const title = input.title.trim();

      if (title !== this.props.title) {
        nextProperties.title = title;
        changed = true;
      }
    }

    if (input.description !== undefined) {
      const description = normalizeOptionalText(input.description);

      if (description !== this.props.description) {
        nextProperties.description = description;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    nextProperties.updatedAt = input.now;

    NarrativeTransition.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  toSnapshot(): NarrativeTransitionProperties {
    return { ...this.props };
  }

  private static validate(props: NarrativeTransitionProperties): void {
    if (props.id.trim() === "") {
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

    if (!NARRATIVE_TRANSITION_SOURCE_TYPES.includes(props.sourceEntityType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid narrative transition source entity type",
      );
    }

    // Opaque cross-aggregate token, same treatment as Scene.chapterId: the
    // service resolves it through ContentEntityLocator before create() is
    // called, and answers 404 for a row in another project — never 403, so the
    // API cannot be used to confirm another tenant's entity exists.
    if (props.sourceEntityId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Source entity id is required",
      );
    }

    // `title` is NOT NULL (`16:62`) and it is the only thing a reader sees in
    // the causality column of the state-evolution view (`16:191-200`), so an
    // untitled transition is a row that cannot be read back meaningfully.
    if (props.title.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Narrative transition title is required",
      );
    }

    if (props.declaredByUserId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Declared by user id is required",
      );
    }

    if (props.reversesTransitionId !== null) {
      if (props.reversesTransitionId.trim() === "") {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          "Reverses transition id must not be blank",
        );
      }

      // The FK is self-referential (`narrative-transition.prisma:27`), so the
      // database is perfectly happy with a row that reverses itself. The rest of
      // the reversal rules — target exists, same project, already applied or
      // partially applied — need another row to look at and stay in the service
      // (Flow 10 §Declare step 6). This one does not: it is decidable from this
      // row alone, and a self-reversal is the one form that would make the
      // provenance chain a cycle instead of a history.
      if (props.reversesTransitionId === props.id) {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          "Narrative transition cannot reverse itself",
        );
      }
    }
  }
}
