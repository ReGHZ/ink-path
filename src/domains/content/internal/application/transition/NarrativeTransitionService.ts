import {
  NARRATIVE_EFFECT_APPLIED,
  CONTENT_UPDATED,
} from "../../../../../shared/application/events/routingKeys.js";
import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import {
  ContentRelationshipRepositoryConflictError,
  ContentRelationshipRepositoryDuplicateError,
  ContentRelationshipRepositoryNotFoundError,
} from "../../domain/support/ContentRelationshipRepositoryError.js";
import {
  canonicalizeEndpoints,
  type RelationshipDefinition,
} from "../../domain/support/relationshipDefinition.js";
import { domainAttributeFieldOf } from "../../domain/transition/attributeFieldRegistry.js";
import {
  deriveNarrativeTransitionStatus,
  NarrativeTransition,
  type NarrativeTransitionSourceType,
  type NarrativeTransitionStatus,
} from "../../domain/transition/NarrativeTransition.js";
import { NarrativeTransitionRepositoryNotFoundError } from "../../domain/transition/NarrativeTransitionRepositoryError.js";
import {
  TransitionEffect,
  type TransitionEffectType,
} from "../../domain/transition/TransitionEffect.js";
import { ContentAttributeConflictError } from "../ports/ContentAttributeMutatorError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { OutboxEventRepository } from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type { NarrativeTransitionRepository } from "../../domain/transition/NarrativeTransitionRepository.js";
import type { TransitionEffectRepository } from "../../domain/transition/TransitionEffectRepository.js";
import type { ContentEntityLocator } from "../ports/ContentEntityLocator.js";
import type {
  NarrativeTransitionRepositories,
  NarrativeTransitionUnitOfWork,
} from "../ports/NarrativeTransitionUnitOfWork.js";
import type { RelationshipDefinitionReader } from "../ports/RelationshipDefinitionReader.js";

export type DeclareTransitionInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  projectId: string;
  sourceEntityType: NarrativeTransitionSourceType;
  sourceEntityId: string;
  title: string;
  description?: string | null;
  reversesTransitionId?: string | null;
};

export type UpdateTransitionDetailsInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  title?: string;
  description?: string | null;
};

export type MutateTransitionInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
};

type BaseAddEffectInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  targetEntityType: ContentEntityType;
  targetEntityId: string;
};

// Mirrors `CreateTransitionEffectProperties`: the caller cannot express an
// attribute change carrying a relation type, so the impossible request never
// reaches the domain. The DTO layer at 7.8 discriminates on the same field.
export type AddEffectInput =
  | (BaseAddEffectInput & {
      effectType: "attribute_change";
      fieldPath: string;
      newValue: string;
    })
  | (BaseAddEffectInput & {
      effectType: "relationship_add" | "relationship_remove";
      // Plain `string`: rule 1 belongs to the domain, so an unknown relation
      // type is rejected identically here and on the manual relationship path.
      relationshipType: string;
      relatedEntityType: ContentEntityType;
      relatedEntityId: string;
    });

export type TransitionEffectDetail = {
  id: string;
  narrativeTransitionId: string;
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

// `status` is computed here, never stored (`16:71-75`), and the effects travel
// with the transition because the status cannot be produced without them: a
// caller that received a transition alone would have to ask for the effects to
// learn anything about its state.
export type NarrativeTransitionDetail = {
  id: string;
  projectId: string;
  sourceEntityType: NarrativeTransitionSourceType;
  sourceEntityId: string;
  title: string;
  description: string | null;
  declaredByUserId: string;
  reversesTransitionId: string | null;
  status: NarrativeTransitionStatus;
  effects: TransitionEffectDetail[];
  createdAt: Date;
  updatedAt: Date;
};

// Flow 10's role matrix (`02-system-design/03_flow_10_narrative_transition.md:15-21`)
// gives Writer and Editor every column and Reviewer none — declare, add, delete,
// apply and reversal alike. One guard, no `assertCanDelete` twin: deleting a
// PENDING effect destroys an intention, not content, and an applied one cannot
// be deleted by anybody. Same shape as RelationshipService, for the same reason.
function assertCanWrite(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Reviewer role cannot modify narrative transitions",
    );
  }
}

function mapNarrativeTransitionError(error: unknown): never {
  if (error instanceof NarrativeTransitionRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Narrative transition not found");
  }

  // The relationship vanished between the lookup and the guarded delete — under
  // READ COMMITTED that is possible even inside one transaction. It is the SAME
  // world-fact as the pre-check further down ("the link this effect would remove
  // is not there"), so it must get the same answer: 409 with the same sentence.
  //
  // It used to fall into the 404 above, which was wrong twice over at the 7.7
  // gate: one condition answered with two different status codes depending on
  // which of two racing paths noticed it, and a message that named the
  // transition — which exists — as the missing thing.
  if (error instanceof ContentRelationshipRepositoryNotFoundError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "The relationship this effect would remove does not exist",
    );
  }

  // Decision D5: the world already holds the state this effect intends. Marking
  // it applied would claim this transition caused a relationship somebody else
  // created by hand — provenance is two-pathed on purpose (keputusan #12), and
  // conflating the paths is exactly what append-only exists to prevent. The
  // writer's way out is to delete the pending effect.
  if (error instanceof ContentRelationshipRepositoryDuplicateError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "The relationship this effect would add already exists",
    );
  }

  if (
    error instanceof ContentRelationshipRepositoryConflictError ||
    error instanceof ContentAttributeConflictError
  ) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Target was modified concurrently, apply was rolled back",
    );
  }

  // Every DomainError reaching here is caller-fixable input: an unknown relation
  // type, a disallowed pair, a field the allowlist refuses, a blank title, a
  // value the target aggregate rejects. Without this branch errorHandler only
  // special-cases AppError and they would all surface as 500.
  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class NarrativeTransitionService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly narrativeTransitionRepository: NarrativeTransitionRepository,
    private readonly transitionEffectRepository: TransitionEffectRepository,
    private readonly contentEntityLocator: ContentEntityLocator,
    private readonly narrativeTransitionUnitOfWork: NarrativeTransitionUnitOfWork,
    private readonly relationshipDefinitionReader: RelationshipDefinitionReader,
  ) {}

  async declareTransition(
    input: DeclareTransitionInput,
  ): Promise<NarrativeTransitionDetail> {
    assertCanWrite(input.requestingMembership);

    // Flow 10 §Declare step 5. The source must exist, be of the declared type
    // and live in this project — one `locate()` answers all three, and a row in
    // another project answers 404 rather than 403 so the endpoint cannot be used
    // to probe another tenant.
    await this.assertEntityInProject(
      input.projectId,
      input.sourceEntityType,
      input.sourceEntityId,
      "Source",
    );

    if (
      input.reversesTransitionId !== undefined &&
      input.reversesTransitionId !== null
    ) {
      await this.assertReversible(input.projectId, input.reversesTransitionId);
    }

    let transition: NarrativeTransition;
    try {
      transition = NarrativeTransition.create({
        id: this.idGenerator.generate(),
        projectId: input.projectId,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        title: input.title,
        description: input.description,
        declaredByUserId: input.requestingUserId,
        reversesTransitionId: input.reversesTransitionId,
        now: this.clock.now(),
      });
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    try {
      await this.narrativeTransitionRepository.insert(transition);
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    // A transition is born with no effects, so its status is `declared` and the
    // list is empty — no read needed to say so.
    return toTransitionDetail(transition, []);
  }

  // No role guard on reads: Flow 10 restricts the mutating columns only, and
  // membership itself is already enforced by the project-scoped router (6.5).
  async getTransitionById(
    projectId: string,
    transitionId: string,
  ): Promise<NarrativeTransitionDetail> {
    const transition = await this.loadExistingTransition(
      projectId,
      transitionId,
    );

    return toTransitionDetail(
      transition,
      await this.transitionEffectRepository.findByTransitionId(transition.id),
    );
  }

  async listTransitionsByProject(
    projectId: string,
  ): Promise<NarrativeTransitionDetail[]> {
    return this.withEffects(
      await this.narrativeTransitionRepository.findByProjectId(projectId),
    );
  }

  async listTransitionsBySourceEntity(
    projectId: string,
    sourceEntityType: NarrativeTransitionSourceType,
    sourceEntityId: string,
  ): Promise<NarrativeTransitionDetail[]> {
    // The entity is validated before its transitions are listed, exactly as
    // RelationshipService does for nested relationship lists: an id from another
    // project must answer 404, not a plausible-looking empty list.
    await this.assertEntityInProject(
      projectId,
      sourceEntityType,
      sourceEntityId,
      "Source",
    );

    return this.withEffects(
      await this.narrativeTransitionRepository.findBySourceEntity(
        projectId,
        sourceEntityType,
        sourceEntityId,
      ),
    );
  }

  async updateTransitionDetails(
    projectId: string,
    transitionId: string,
    input: UpdateTransitionDetailsInput,
  ): Promise<NarrativeTransitionDetail> {
    assertCanWrite(input.requestingMembership);

    const transition = await this.loadExistingTransition(
      projectId,
      transitionId,
    );

    let changed: boolean;
    try {
      changed = transition.updateDetails({
        title: input.title,
        description: input.description,
        now: this.clock.now(),
      });
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    if (changed) {
      try {
        await this.narrativeTransitionRepository.update(transition);
      } catch (error) {
        mapNarrativeTransitionError(error);
      }
    }

    return toTransitionDetail(
      transition,
      await this.transitionEffectRepository.findByTransitionId(transition.id),
    );
  }

  // Append-only guard + app-level cascade in ONE transaction (`16:138`,
  // `05-implementation-policy/05_append_only_invariants.md:56-57`). The FK is
  // `onDelete: Restrict`, so the children must go first and the database will
  // refuse the parent if any survives.
  async deleteTransition(
    projectId: string,
    transitionId: string,
    input: MutateTransitionInput,
  ): Promise<void> {
    assertCanWrite(input.requestingMembership);

    await this.narrativeTransitionUnitOfWork.transaction(
      async (repositories) => {
        // The AGGREGATE ROOT lock, taken before anything is read. Without it the
        // guard below is blind to a child born after its read: `addEffect` used
        // to need no lock at all, so an effect could be inserted AND applied
        // between this read and the blanket delete, and the blanket delete would
        // then destroy an applied fact. Waiting on the child locks cannot help —
        // the row did not exist when they were taken. Found at the 7.7 gate.
        const transition =
          await repositories.narrativeTransitions.findByIdForUpdate(
            transitionId,
          );

        if (transition?.projectId !== projectId) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            "Narrative transition not found",
          );
        }

        const effects =
          await repositories.transitionEffects.findByTransitionId(transitionId);

        // Each child is LOCKED too, and the root lock does not make this
        // redundant: apply deliberately does NOT take the root lock, so an apply
        // of an existing effect can still be in flight. This is what makes it
        // wait and then be seen. Locking in the list's own order (createdAt asc,
        // id tie-break) is the same order bulk apply walks, so the two cannot
        // deadlock against each other.
        for (const effect of effects) {
          const locked = await repositories.transitionEffects.findByIdForUpdate(
            effect.id,
          );

          if (locked?.isApplied === true) {
            throw new AppError(
              ErrorCode.CONFLICT,
              "Transition has applied effects and cannot be deleted — declare a reversal instead",
            );
          }
        }

        try {
          // One blanket statement rather than a delete per locked id, and that
          // is only safe BECAUSE the root lock is held: no child can be born
          // between the guard above and this line, so "every child" and "every
          // child we inspected" are the same set.
          await repositories.transitionEffects.deleteByTransitionId(
            transitionId,
          );
          await repositories.narrativeTransitions.delete(transitionId);
        } catch (error) {
          mapNarrativeTransitionError(error);
        }
      },
    );
  }

  async addEffect(
    projectId: string,
    transitionId: string,
    input: AddEffectInput,
  ): Promise<TransitionEffectDetail> {
    assertCanWrite(input.requestingMembership);

    // Endpoint checks run on the pooled client BEFORE the transaction opens, the
    // same ordering apply uses: `ContentEntityLocator` is built over the pool, so
    // calling it inside would take a second connection while holding the first.
    //
    // Flow 10 §Add Effect step 4 for the target, and the same check for the
    // related entity of a relationship effect — an effect whose endpoints do not
    // exist is one that can never be applied.
    await this.assertEntityInProject(
      projectId,
      input.targetEntityType,
      input.targetEntityId,
      "Target",
    );


    let effect: TransitionEffect;

    if (input.effectType === "attribute_change") {
      try {
        effect = TransitionEffect.create({
          id: this.idGenerator.generate(),
          narrativeTransitionId: transitionId,
          projectId,
          effectType: "attribute_change",
          targetEntityType: input.targetEntityType,
          targetEntityId: input.targetEntityId,
          fieldPath: input.fieldPath,
          newValue: input.newValue,
          now: this.clock.now(),
        });
      } catch (error) {
        mapNarrativeTransitionError(error);
      }
    } else {
      // Flow 10 §Add Effect, the related endpoint — an effect whose endpoints do
      // not exist is one that can never be applied.
      await this.assertEntityInProject(
        projectId,
        input.relatedEntityType,
        input.relatedEntityId,
        "Related",
      );

      // Rule 1 on the DECLARE path, read from the project's own vocabulary.
      // Loaded here, before the transaction opens, for the same reason the
      // endpoint checks are: this reader is built over the pool, so calling it
      // inside would take a second connection while holding the first.
      const definition =
        await this.relationshipDefinitionReader.findByPredicate(
          projectId,
          input.relationshipType,
        );

      if (definition === null) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unknown relation type: ${input.relationshipType}`,
        );
      }

      try {
        effect = TransitionEffect.create({
          id: this.idGenerator.generate(),
          narrativeTransitionId: transitionId,
          projectId,
          effectType: input.effectType,
          targetEntityType: input.targetEntityType,
          targetEntityId: input.targetEntityId,
          relationshipType: input.relationshipType,
          definition,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
          now: this.clock.now(),
        });
      } catch (error) {
        mapNarrativeTransitionError(error);
      }
    }

    // In a transaction, under the AGGREGATE ROOT lock, even though the write
    // itself is a single insert. The lock is not protecting the insert — it is
    // protecting `deleteTransition`, which must be able to trust that the set of
    // children it inspected is the set it deletes. Without this, a child could
    // be inserted between that guard and its blanket delete, applied by a third
    // request, and destroyed as an applied fact. Found at the 7.7 gate.
    await this.narrativeTransitionUnitOfWork.transaction(
      async (repositories) => {
        const transition =
          await repositories.narrativeTransitions.findByIdForUpdate(
            transitionId,
          );

        if (transition?.projectId !== projectId) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            "Narrative transition not found",
          );
        }

        try {
          await repositories.transitionEffects.insert(effect);
        } catch (error) {
          mapNarrativeTransitionError(error);
        }
      },
    );

    return toEffectDetail(effect);
  }

  async deleteEffect(
    projectId: string,
    effectId: string,
    input: MutateTransitionInput,
  ): Promise<void> {
    assertCanWrite(input.requestingMembership);

    await this.narrativeTransitionUnitOfWork.transaction(
      async (repositories) => {
        // Locked, not merely read: the guard below and a concurrent apply are
        // deciding the same row's fate, and the lock is what makes one of them
        // wait instead of both winning.
        const effect =
          await repositories.transitionEffects.findByIdForUpdate(effectId);

        if (effect?.projectId !== projectId) {
          throw new AppError(ErrorCode.NOT_FOUND, "Transition effect not found");
        }

        if (effect.isApplied) {
          throw new AppError(
            ErrorCode.CONFLICT,
            "Applied effect cannot be deleted — declare a reversal instead",
          );
        }

        try {
          await repositories.transitionEffects.delete(effectId);
        } catch (error) {
          mapNarrativeTransitionError(error);
        }
      },
    );
  }

  async applyEffect(
    projectId: string,
    effectId: string,
    input: MutateTransitionInput,
  ): Promise<TransitionEffectDetail> {
    assertCanWrite(input.requestingMembership);

    // Endpoint existence is resolved BEFORE the transaction opens. The locator
    // is built over the pooled client, so calling it inside would ask for a
    // second connection while holding the first — the same reason 7.4b keeps
    // name resolution outside its delete transaction
    // (`../support/contentRelationshipDeleteGuard.ts`).
    const pending = await this.loadPendingEffectForApply(projectId, effectId);

    if (pending === null) {
      // Already applied before this request arrived. Idempotent success, not a
      // conflict (`flow_10:93`): the caller asked for a state that holds.
      return toEffectDetail(
        await this.loadExistingEffect(projectId, effectId),
      );
    }

    // Read before the transaction opens, same reason as the batch path above.
    const definitions =
      await this.relationshipDefinitionReader.findAllByProject(projectId);

    return this.narrativeTransitionUnitOfWork.transaction(
      async (repositories, outboxEvents) =>
        this.applyOneEffect(
          repositories,
          outboxEvents,
          projectId,
          effectId,
          input.requestingUserId,
          definitions,
        ),
    );
  }

  // Decision D9. Every pending effect of one transition, in ONE transaction:
  // all of them apply or none does. Partial success was rejected — a transition
  // half-applied by a single click is the state `partially_applied` already
  // exists to describe deliberately, and reporting "3 of 5 worked, retry the
  // rest" turns one atomic story beat into a job queue. The escape hatch for a
  // single stuck effect is to delete it and apply again.
  //
  // Not a new primitive: it walks the same `applyOneEffect` the per-effect
  // endpoint uses, so the row lock and the idempotency re-check are identical.
  async applyTransition(
    projectId: string,
    transitionId: string,
    input: MutateTransitionInput,
  ): Promise<NarrativeTransitionDetail> {
    assertCanWrite(input.requestingMembership);

    const transition = await this.loadExistingTransition(
      projectId,
      transitionId,
    );

    const declared =
      await this.transitionEffectRepository.findByTransitionId(transition.id);

    for (const effect of declared) {
      if (!effect.isApplied) {
        await this.loadPendingEffectForApply(projectId, effect.id);
      }
    }

    // The whole vocabulary, read on the pooled client BEFORE the transaction —
    // same rule the endpoint checks follow: this reader is built over the pool,
    // so calling it inside the transaction would take a second connection while
    // holding the first. One map for the whole loop, since several effects
    // commonly share a predicate.
    const definitions =
      await this.relationshipDefinitionReader.findAllByProject(projectId);

    await this.narrativeTransitionUnitOfWork.transaction(
      async (repositories, outboxEvents) => {
        const effects =
          await repositories.transitionEffects.findByTransitionId(transitionId);

        // Same order the delete guard locks in, so the two never deadlock.
        for (const effect of effects) {
          await this.applyOneEffect(
            repositories,
            outboxEvents,
            projectId,
            effect.id,
            input.requestingUserId,
            definitions,
          );
        }
      },
    );

    return toTransitionDetail(
      transition,
      await this.transitionEffectRepository.findByTransitionId(transition.id),
    );
  }

  // The shared body of both apply paths. Everything it does happens inside the
  // caller's transaction, starting with the row lock.
  private async applyOneEffect(
    repositories: NarrativeTransitionRepositories,
    outboxEvents: OutboxEventRepository,
    projectId: string,
    effectId: string,
    requestingUserId: string,
    definitions: ReadonlyMap<string, RelationshipDefinition>,
  ): Promise<TransitionEffectDetail> {
    const effect =
      await repositories.transitionEffects.findByIdForUpdate(effectId);

    if (effect?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Transition effect not found");
    }

    // The idempotency re-check REQUIRED by `flow_10:101,115`, and the reason the
    // lock above is not decoration: two concurrent applies both saw pending
    // before either locked, and this is where the loser finds out. Returning
    // success rather than 409 is deliberate — the effect is applied, which is
    // what the caller asked for; a second ContentRevision is what must not
    // happen.
    if (effect.isApplied) {
      return toEffectDetail(effect);
    }

    const now = this.clock.now();

    if (effect.effectType === "attribute_change") {
      await this.applyAttributeChange(
        repositories,
        outboxEvents,
        effect,
        requestingUserId,
        now,
      );
    } else {
      await this.applyRelationshipChange(
        repositories,
        outboxEvents,
        effect,
        requestingUserId,
        now,
        definitions,
      );
    }

    try {
      await repositories.transitionEffects.update(effect);
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    return toEffectDetail(effect);
  }

  private async applyAttributeChange(
    repositories: NarrativeTransitionRepositories,
    outboxEvents: OutboxEventRepository,
    effect: TransitionEffect,
    requestingUserId: string,
    now: Date,
  ): Promise<void> {
    // Decision D3's second half: the allowlist is checked again at apply, not
    // only when the effect was declared. It is a Phase 7 table over columns that
    // will keep changing, so a field that stops being writable must stop being
    // appliable — while the effect itself stays readable and deletable
    // (`../../domain/transition/TransitionEffect.ts` create()).
    const domainField =
      effect.fieldPath === null
        ? null
        : domainAttributeFieldOf(effect.targetEntityType, effect.fieldPath);

    if (domainField === null || effect.newValue === null) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Field ${String(effect.fieldPath)} is no longer writable by a narrative transition on ${effect.targetEntityType}`,
      );
    }

    const revisionId = this.idGenerator.generate();

    let applied;
    try {
      applied = await repositories.contentAttributes.applyAttributeChange({
        entityType: effect.targetEntityType,
        entityId: effect.targetEntityId,
        domainField,
        newValue: effect.newValue,
        revisionId,
        changedByUserId: requestingUserId,
        now,
      });
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    if (applied?.projectId !== effect.projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Target entity not found");
    }

    // Decision D5 applied to attributes: the field already holds the intended
    // value, so nothing was written and there is no revision to point at.
    // Stamping `applied_at` anyway would produce an applied attribute change
    // with no provenance — a row the domain refuses to build, and rightly.
    if (!applied.changed) {
      throw new AppError(
        ErrorCode.CONFLICT,
        "Target entity already holds the intended value",
      );
    }

    try {
      effect.markApplied({ contentRevisionId: revisionId, now });
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    // The EXISTING content event, not a narrative one: an attribute change
    // rewrites indexed text, so the embedding worker has to see the same shape
    // it sees for a manual edit or Qdrant goes stale (decision D6). Payload is
    // copied field-for-field from `persistChange()` in the nine content
    // services — a divergence here would be invisible until a consumer broke.
    await outboxEvents.insert({
      id: this.idGenerator.generate(),
      eventType: CONTENT_UPDATED,
      eventVersion: 1,
      aggregateType: effect.targetEntityType,
      aggregateId: effect.targetEntityId,
      projectId: effect.projectId,
      triggeredByUserId: requestingUserId,
      payload: {
        projectId: effect.projectId,
        entityType: effect.targetEntityType,
        entityId: effect.targetEntityId,
        revisionId,
        revisionNumber: applied.revisionNumber,
        changedByUserId: requestingUserId,
      },
      routingKey: CONTENT_UPDATED,
      exchange: "saas.events",
    });
  }

  private async applyRelationshipChange(
    repositories: NarrativeTransitionRepositories,
    outboxEvents: OutboxEventRepository,
    effect: TransitionEffect,
    requestingUserId: string,
    now: Date,
    definitions: ReadonlyMap<string, RelationshipDefinition>,
  ): Promise<void> {
    const narrativeTransitionId = effect.narrativeTransitionId;
    const relationshipType = effect.relationshipType;
    const relatedEntityType = effect.relatedEntityType;
    const relatedEntityId = effect.relatedEntityId;

    if (
      narrativeTransitionId === null ||
      relationshipType === null ||
      relatedEntityType === null ||
      relatedEntityId === null
    ) {
      // Unreachable through the domain, which refuses to build such an effect.
      // Kept because the alternative is non-null assertions on three fields, and
      // a stored row that somehow drifted deserves a 500 that says so rather
      // than a TypeError deeper in.
      throw new Error(
        `Relationship effect ${effect.id} is missing its relationship fields or its parent transition`,
      );
    }

    // REACHABLE, unlike the guard above, and that is the difference worth
    // naming: declare checked this predicate against the vocabulary, but
    // `transition_effects.relationship_type` carries no foreign key, so an
    // author who deletes the predicate between declare and apply leaves an
    // effect pointing at a name their project no longer has. A 400 that names it
    // is the honest answer — the transition is still declarable, and redefining
    // the predicate makes it appliable again.
    const definition = definitions.get(relationshipType);

    if (definition === undefined) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unknown relation type: ${relationshipType}`,
      );
    }

    if (effect.effectType === "relationship_add") {
      let relationship: ContentRelationship;
      try {
        // Through the domain aggregate, never straight to the repository. This
        // is the second write path into `content_relationships` the registry
        // warned about: canonicalisation, the pair matrix and the
        // self-relationship rule all live in create(), so going around it would
        // let a narrative effect store a row the manual endpoint would refuse.
        relationship = ContentRelationship.create({
          id: this.idGenerator.generate(),
          projectId: effect.projectId,
          relationType: relationshipType,
          definition,
          source: {
            entityType: effect.targetEntityType,
            entityId: effect.targetEntityId,
          },
          target: { entityType: relatedEntityType, entityId: relatedEntityId },
          // The effect row IS the assertion on this path (step 4b-2): it is the
          // log entry stating the fact, and applying it is what makes the fact
          // hold. No separate assertion is written, which is why this is
          // `effect.id` rather than a generated one — a generated id would point
          // at a row that does not exist and the composite foreign key would
          // refuse it.
          sourceAssertionId: effect.id,
          createdByUserId: requestingUserId,
          now,
        });
      } catch (error) {
        mapNarrativeTransitionError(error);
      }

      try {
        await repositories.contentRelationships.insert(relationship);
      } catch (error) {
        mapNarrativeTransitionError(error);
      }
    } else {
      // Decision D4. The effect stores endpoints as declared and no row id, so
      // the row is found by its natural identity: the canonical orientation of
      // (type, endpoints), which is what the six-column unique index keys on.
      // `findByEntity` is reused rather than a new `findByEndpoints` — it is
      // already indexed on both sides, and it returns the aggregate, which
      // carries the `version` the guarded delete needs. That version is read
      // inside this transaction and spent inside it, which is exactly the
      // interleaving the guard protects (`ContentRelationshipRepository.ts:102-113`).
      const { source, target } = canonicalizeEndpoints(
        definition.directionality,
        {
          entityType: effect.targetEntityType,
          entityId: effect.targetEntityId,
        },
        { entityType: relatedEntityType, entityId: relatedEntityId },
      );

      const existing = (
        await repositories.contentRelationships.findByEntity(
          effect.projectId,
          effect.targetEntityType,
          effect.targetEntityId,
        )
      ).find(
        (candidate) =>
          candidate.relationType === relationshipType &&
          candidate.sourceEntityType === source.entityType &&
          candidate.sourceEntityId === source.entityId &&
          candidate.targetEntityType === target.entityType &&
          candidate.targetEntityId === target.entityId,
      );

      // Decision D5, the remove half: the link this effect would cut is not
      // there. Silently marking it applied would record that this transition
      // severed a relationship it never touched.
      if (existing === undefined) {
        throw new AppError(
          ErrorCode.CONFLICT,
          "The relationship this effect would remove does not exist",
        );
      }

      try {
        await repositories.contentRelationships.delete(
          existing.id,
          existing.version,
        );
      } catch (error) {
        mapNarrativeTransitionError(error);
      }
    }

    try {
      // No revision pointer: a relationship change writes no ContentRevision at
      // all (`16:105`, `flow_10:117`), and the domain refuses one here.
      effect.markApplied({ now });
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    // A causality event, NOT `content.updated` (decision D6). No entity text
    // changed, so nothing is re-indexed and the embedding worker must not be
    // woken; what this event exists for is the event-sourced evaluation graph of
    // the Validation domain (Phase 11), which needs relationship changes to
    // arrive as forward events — including reversals
    // (`05-implementation-policy/05_append_only_invariants.md:80-85`).
    //
    // CORRECTED 2026-08-19 (gerbang G1, T-4). This used to read "manual
    // relationship edits still emit nothing … narrative changes are permanent
    // history, manual ones are ephemeral by design". Steps 4b-1/4b-2 ended that
    // asymmetry: the CRUD path writes its own assertions and emits
    // `content.relationship.asserted` / `content.relationship.retracted`. BOTH
    // paths are permanent history now, and keputusan #12's two-path provenance
    // survives only as WHICH log a fact is born in — not as whether it is recorded
    // at all. See the header comment above `class RelationshipService`.
    await outboxEvents.insert({
      id: this.idGenerator.generate(),
      eventType: NARRATIVE_EFFECT_APPLIED,
      eventVersion: 1,
      aggregateType: "narrative_transition",
      aggregateId: narrativeTransitionId,
      projectId: effect.projectId,
      triggeredByUserId: requestingUserId,
      payload: {
        projectId: effect.projectId,
        narrativeTransitionId: effect.narrativeTransitionId,
        effectId: effect.id,
        effectType: effect.effectType,
        relationshipType,
        targetEntityType: effect.targetEntityType,
        targetEntityId: effect.targetEntityId,
        relatedEntityType,
        relatedEntityId,
        appliedByUserId: requestingUserId,
      },
      routingKey: NARRATIVE_EFFECT_APPLIED,
      exchange: "saas.events",
    });
  }

  // Returns null when the effect is already applied, so the caller can answer
  // idempotently without opening a transaction. Everything it checks is
  // re-checked under the lock — this pass exists to keep the pooled-client reads
  // (locator) out of the transaction, not to replace the authoritative ones.
  private async loadPendingEffectForApply(
    projectId: string,
    effectId: string,
  ): Promise<TransitionEffect | null> {
    const effect = await this.loadExistingEffect(projectId, effectId);

    if (effect.isApplied) {
      return null;
    }

    await this.assertEntityInProject(
      projectId,
      effect.targetEntityType,
      effect.targetEntityId,
      "Target",
    );

    if (effect.relatedEntityType !== null && effect.relatedEntityId !== null) {
      await this.assertEntityInProject(
        projectId,
        effect.relatedEntityType,
        effect.relatedEntityId,
        "Related",
      );
    }

    return effect;
  }

  private async loadExistingEffect(
    projectId: string,
    effectId: string,
  ): Promise<TransitionEffect> {
    const effect = await this.transitionEffectRepository.findById(effectId);

    if (effect?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Transition effect not found");
    }

    return effect;
  }

  private async loadExistingTransition(
    projectId: string,
    transitionId: string,
  ): Promise<NarrativeTransition> {
    const transition =
      await this.narrativeTransitionRepository.findById(transitionId);

    if (transition?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Narrative transition not found");
    }

    return transition;
  }

  // Flow 10 §Declare step 6. A reversal only means something against a
  // transition that actually happened: reversing a `declared` one would be a
  // record of undoing nothing, and the writer's real intent there is to delete
  // the pending effects.
  private async assertReversible(
    projectId: string,
    reversesTransitionId: string,
  ): Promise<void> {
    const reversed = await this.loadExistingTransition(
      projectId,
      reversesTransitionId,
    );

    const status = deriveNarrativeTransitionStatus(
      await this.transitionEffectRepository.findByTransitionId(reversed.id),
    );

    if (status === "declared") {
      throw new AppError(
        ErrorCode.CONFLICT,
        "Only an applied or partially applied transition can be reversed",
      );
    }
  }

  // "Does not exist" and "belongs to another project" answer the SAME 404, and
  // the message names neither: distinguishing them would turn this endpoint into
  // an existence oracle for another tenant's entities.
  private async assertEntityInProject(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
    subject: string,
  ): Promise<void> {
    const location = await this.contentEntityLocator.locate({
      entityType,
      entityId,
    });

    if (location?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, `${subject} entity not found`);
    }
  }

  private async withEffects(
    transitions: readonly NarrativeTransition[],
  ): Promise<NarrativeTransitionDetail[]> {
    const details: NarrativeTransitionDetail[] = [];

    // Sequential rather than Promise.all: each iteration takes a connection from
    // the pool, and a project with fifty transitions would otherwise ask for
    // fifty at once. Pagination is the real answer and is deliberately deferred
    // until a caller needs it (same call the 7.1 gate made for relationship
    // lists).
    for (const transition of transitions) {
      details.push(
        toTransitionDetail(
          transition,
          await this.transitionEffectRepository.findByTransitionId(
            transition.id,
          ),
        ),
      );
    }

    return details;
  }
}

// Same class of guard as the one in applyRelationshipChange, and here for the
// same reason: `PrismaTransitionEffectRepository.findById` scopes its query to
// rows that HAVE a parent, so every effect this service returns has one. The
// type cannot express a repository's scope, and the alternatives are worse — a
// non-null assertion hides the assumption from the compiler, `?? ""` puts a lie
// on the wire, and widening `TransitionEffectDetail` would ask every client to
// handle a case these routes cannot produce. A row that somehow drifted deserves
// a 500 that names it.
//
// Deliberately NOT in the DTO mapper: translation must not have a branch that
// can fail. That mistake was made once already and cut before it ran
// (`notes/phase-11-validation.md` §Domain baru validation).
function toEffectDetail(effect: TransitionEffect): TransitionEffectDetail {
  const narrativeTransitionId = effect.narrativeTransitionId;

  if (narrativeTransitionId === null) {
    throw new Error(
      `Transition effect ${effect.id} has no parent transition; it is an assertion, not an effect of this aggregate`,
    );
  }

  return {
    id: effect.id,
    narrativeTransitionId,
    projectId: effect.projectId,
    effectType: effect.effectType,
    targetEntityType: effect.targetEntityType,
    targetEntityId: effect.targetEntityId,
    fieldPath: effect.fieldPath,
    newValue: effect.newValue,
    relationshipType: effect.relationshipType,
    relatedEntityType: effect.relatedEntityType,
    relatedEntityId: effect.relatedEntityId,
    appliedAt: effect.appliedAt,
    contentRevisionId: effect.contentRevisionId,
    createdAt: effect.createdAt,
  };
}

function toTransitionDetail(
  transition: NarrativeTransition,
  effects: readonly TransitionEffect[],
): NarrativeTransitionDetail {
  return {
    id: transition.id,
    projectId: transition.projectId,
    sourceEntityType: transition.sourceEntityType,
    sourceEntityId: transition.sourceEntityId,
    title: transition.title,
    description: transition.description,
    declaredByUserId: transition.declaredByUserId,
    reversesTransitionId: transition.reversesTransitionId,
    status: deriveNarrativeTransitionStatus(effects),
    effects: effects.map((effect) => toEffectDetail(effect)),
    createdAt: transition.createdAt,
    updatedAt: transition.updatedAt,
  };
}

export function createNarrativeTransitionService({
  clock,
  idGenerator,
  narrativeTransitionRepository,
  transitionEffectRepository,
  contentEntityLocator,
  narrativeTransitionUnitOfWork,
  relationshipDefinitionReader,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  narrativeTransitionRepository: NarrativeTransitionRepository;
  transitionEffectRepository: TransitionEffectRepository;
  contentEntityLocator: ContentEntityLocator;
  narrativeTransitionUnitOfWork: NarrativeTransitionUnitOfWork;
  relationshipDefinitionReader: RelationshipDefinitionReader;
}): NarrativeTransitionService {
  return new NarrativeTransitionService(
    clock,
    idGenerator,
    narrativeTransitionRepository,
    transitionEffectRepository,
    contentEntityLocator,
    narrativeTransitionUnitOfWork,
    relationshipDefinitionReader,
  );
}
