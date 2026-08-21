import {
  NARRATIVE_ASSERTION_APPLIED,
  CONTENT_UPDATED,
} from "../../../../../shared/application/events/routingKeys.js";
import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import {
  ContentRelationshipRepositoryConflictError,
  ContentRelationshipRepositoryDuplicateError,
  ContentRelationshipRepositoryNotFoundError,
} from "../../domain/support/ContentRelationshipRepositoryError.js";
import {
  Assertion,
  type AssertionOperation,
} from "../../domain/transition/Assertion.js";
import { domainAttributeFieldOf } from "../../domain/transition/attributeFieldRegistry.js";
import {
  deriveNarrativeTransitionStatus,
  NarrativeTransition,
  type NarrativeTransitionSourceType,
  type NarrativeTransitionStatus,
} from "../../domain/transition/NarrativeTransition.js";
import {
  NarrativeTransitionRepositoryChildSurvivedError,
  NarrativeTransitionRepositoryNotFoundError,
} from "../../domain/transition/NarrativeTransitionRepositoryError.js";
import { ContentAttributeConflictError } from "../ports/ContentAttributeMutatorError.js";
import { findFoldOfFact, foldAssertion } from "../support/relationshipProjection.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { OutboxEventRepository } from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type { RelationshipDefinition } from "../../domain/support/relationshipDefinition.js";
import type { AssertionRepository } from "../../domain/transition/AssertionRepository.js";
import type { NarrativeTransitionRepository } from "../../domain/transition/NarrativeTransitionRepository.js";
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

// Mirrors `CreateAssertionProperties`: the caller cannot express an
// attribute change carrying a relation type, so the impossible request never
// reaches the domain. The DTO layer at 7.8 discriminates on the same field.
export type AddEffectInput =
  | (BaseAddEffectInput & {
      operation: "attribute_change";
      fieldPath: string;
      newValue: string;
    })
  | (BaseAddEffectInput & {
      operation: "relationship_add" | "relationship_remove";
      // Plain `string`: rule 1 belongs to the domain, so an unknown relation
      // type is rejected identically here and on the manual relationship path.
      relationshipType: string;
      relatedEntityType: ContentEntityType;
      relatedEntityId: string;
    });

export type AssertionDetail = {
  id: string;
  narrativeTransitionId: string;
  projectId: string;
  operation: AssertionOperation;
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

// `status` is computed here, never stored (`16:71-75`), and the assertions travel
// with the transition because the status cannot be produced without them: a
// caller that received a transition alone would have to ask for the assertions to
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
  assertions: AssertionDetail[];
  createdAt: Date;
  updatedAt: Date;
};

// Flow 10's role matrix (`02-system-design/03_flow_10_narrative_transition.md:15-21`)
// gives Writer and Editor every column and Reviewer none — declare, add, delete,
// apply and reversal alike. One guard, no `assertCanDelete` twin: deleting a
// PENDING assertion destroys an intention, not content, and an applied one cannot
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
  // world-fact as the pre-check further down ("the link this assertion would remove
  // is not there"), so it must get the same answer: 409 with the same sentence.
  //
  // It used to fall into the 404 above, which was wrong twice over at the 7.7
  // gate: one condition answered with two different status codes depending on
  // which of two racing paths noticed it, and a message that named the
  // transition — which exists — as the missing thing.
  // Step 4b-5 made this REACHABLE by design. The parent delete leans on the FK
  // to refuse while a child survives — a child born after the delete read its
  // list, or applied while it was working — and that is the same world-fact the
  // per-child guard answers a few lines up in `deleteTransition`. One condition,
  // one status code, one sentence: without this branch the race answers 500 while
  // the guard answers 409 (measured at step 4b-5 langkah 2, mutan M3).
  if (error instanceof NarrativeTransitionRepositoryChildSurvivedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Transition has applied assertions and cannot be deleted — declare a reversal instead",
    );
  }

  if (error instanceof ContentRelationshipRepositoryNotFoundError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "The relationship this assertion would remove does not exist",
    );
  }

  // Decision D5: the world already holds the state this assertion intends. Marking
  // it applied would claim this transition caused a relationship somebody else
  // created by hand — provenance is two-pathed on purpose (keputusan #12), and
  // conflating the paths is exactly what append-only exists to prevent. The
  // writer's way out is to delete the pending assertion.
  if (error instanceof ContentRelationshipRepositoryDuplicateError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "The relationship this assertion would add already exists",
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
    private readonly assertionRepository: AssertionRepository,
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

    // A transition is born with no assertions, so its status is `declared` and the
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
      await this.assertionRepository.findByTransitionId(transition.id),
    );
  }

  async listTransitionsByProject(
    projectId: string,
  ): Promise<NarrativeTransitionDetail[]> {
    return this.withAssertions(
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

    return this.withAssertions(
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
      await this.assertionRepository.findByTransitionId(transition.id),
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
        // Step 4b-5. No aggregate-root lock any more, and the guard below is no
        // longer blind without it — the reason is split in two, and both halves
        // have to be true:
        //
        //   A child ALREADY here cannot slip through, because each is removed by
        //   a predicate-carrying delete that waits for any apply in flight and
        //   then sees what it committed.
        //
        //   A child born AFTER this list was read cannot be destroyed, because
        //   nothing here destroys a row it did not name: the parent delete is
        //   refused by the FK while any child survives (`Restrict`), and that
        //   refusal is translated, not raw (gate 7.7's failure with the pieces
        //   swapped).
        const transition =
          await repositories.narrativeTransitions.findById(transitionId);

        if (transition?.projectId !== projectId) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            "Narrative transition not found",
          );
        }

        const assertions =
          await repositories.assertions.findByTransitionId(transitionId);

        // Per id in the LIST'S OWN ORDER (createdAt asc, id tie-break), not one
        // blanket statement. Bulk apply claims its rows in exactly that order, so
        // the two paths take row locks in the same sequence and cannot deadlock
        // against each other. A blanket `DELETE ... WHERE narrative_transition_id`
        // would lock in scan order, which is unspecified — the anti-deadlock
        // property would be dropped silently rather than decided.
        for (const assertion of assertions) {
          const outcome = await repositories.assertions.deleteIfPending(
            projectId,
            assertion.id,
          );

          if (outcome === "applied") {
            throw new AppError(
              ErrorCode.CONFLICT,
              "Transition has applied assertions and cannot be deleted — declare a reversal instead",
            );
          }
        }

        try {
          await repositories.narrativeTransitions.delete(transitionId);
        } catch (error) {
          mapNarrativeTransitionError(error);
        }
      },
    );
  }

  async addAssertion(
    projectId: string,
    transitionId: string,
    input: AddEffectInput,
  ): Promise<AssertionDetail> {
    assertCanWrite(input.requestingMembership);

    // Endpoint checks run on the pooled client BEFORE the transaction opens, the
    // same ordering apply uses: `ContentEntityLocator` is built over the pool, so
    // calling it inside would take a second connection while holding the first.
    //
    // Flow 10 §Add Effect step 4 for the target, and the same check for the
    // related entity of a relationship assertion — an assertion whose endpoints do not
    // exist is one that can never be applied.
    await this.assertEntityInProject(
      projectId,
      input.targetEntityType,
      input.targetEntityId,
      "Target",
    );


    let assertion: Assertion;

    if (input.operation === "attribute_change") {
      try {
        assertion = Assertion.create({
          id: this.idGenerator.generate(),
          narrativeTransitionId: transitionId,
          projectId,
          operation: "attribute_change",
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
      // Flow 10 §Add Effect, the related endpoint — an assertion whose endpoints do
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
        assertion = Assertion.create({
          id: this.idGenerator.generate(),
          narrativeTransitionId: transitionId,
          projectId,
          operation: input.operation,
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

    // Still a transaction, no longer a lock. What the root lock used to buy here
    // — `deleteTransition` being able to trust that the children it inspected are
    // the children it deletes — is bought differently since step 4b-5: that path
    // deletes only rows it named, and the FK refuses the parent while any child
    // survives. The INSERT's own `FOR KEY SHARE` on the parent row is what makes
    // the two orderings meet, and it is taken by the write itself.
    await this.narrativeTransitionUnitOfWork.transaction(
      async (repositories) => {
        const transition =
          await repositories.narrativeTransitions.findById(transitionId);

        if (transition?.projectId !== projectId) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            "Narrative transition not found",
          );
        }

        try {
          await repositories.assertions.insert(assertion);
        } catch (error) {
          mapNarrativeTransitionError(error);
        }
      },
    );

    return toEffectDetail(assertion);
  }

  async deleteAssertion(
    projectId: string,
    effectId: string,
    input: MutateTransitionInput,
  ): Promise<void> {
    assertCanWrite(input.requestingMembership);

    await this.narrativeTransitionUnitOfWork.transaction(
      async (repositories) => {
        // Step 4b-5. The guard and the delete are ONE statement, so a concurrent
        // apply cannot land between them: the delete waits in the row's lock
        // queue and then re-reads the predicate against what that apply
        // committed. "Zero rows removed" is never reported as success — the
        // adapter says which of the two reasons it was.
        const outcome = await repositories.assertions.deleteIfPending(
          projectId,
          effectId,
        );

        if (outcome === "missing") {
          throw new AppError(ErrorCode.NOT_FOUND, "Transition assertion not found");
        }

        if (outcome === "applied") {
          throw new AppError(
            ErrorCode.CONFLICT,
            "Applied assertion cannot be deleted — declare a reversal instead",
          );
        }
      },
    );
  }

  async applyAssertion(
    projectId: string,
    effectId: string,
    input: MutateTransitionInput,
  ): Promise<AssertionDetail> {
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
        await this.loadExistingAssertion(projectId, effectId),
      );
    }

    // Read before the transaction opens, same reason as the batch path above.
    const definitions =
      await this.relationshipDefinitionReader.findAllByProject(projectId);

    return this.narrativeTransitionUnitOfWork.transaction(
      async (repositories, outboxEvents) =>
        this.applyOneAssertion(
          repositories,
          outboxEvents,
          projectId,
          effectId,
          input.requestingUserId,
          definitions,
        ),
    );
  }

  // Decision D9. Every pending assertion of one transition, in ONE transaction:
  // all of them apply or none does. Partial success was rejected — a transition
  // half-applied by a single click is the state `partially_applied` already
  // exists to describe deliberately, and reporting "3 of 5 worked, retry the
  // rest" turns one atomic story beat into a job queue. The escape hatch for a
  // single stuck assertion is to delete it and apply again.
  //
  // Not a new primitive: it walks the same `applyOneAssertion` the per-assertion
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
      await this.assertionRepository.findByTransitionId(transition.id);

    for (const assertion of declared) {
      if (!assertion.isApplied) {
        await this.loadPendingEffectForApply(projectId, assertion.id);
      }
    }

    // The whole vocabulary, read on the pooled client BEFORE the transaction —
    // same rule the endpoint checks follow: this reader is built over the pool,
    // so calling it inside the transaction would take a second connection while
    // holding the first. One map for the whole loop, since several assertions
    // commonly share a predicate.
    const definitions =
      await this.relationshipDefinitionReader.findAllByProject(projectId);

    await this.narrativeTransitionUnitOfWork.transaction(
      async (repositories, outboxEvents) => {
        const assertions =
          await repositories.assertions.findByTransitionId(transitionId);

        // Same order the delete guard locks in, so the two never deadlock.
        for (const assertion of assertions) {
          await this.applyOneAssertion(
            repositories,
            outboxEvents,
            projectId,
            assertion.id,
            input.requestingUserId,
            definitions,
          );
        }
      },
    );

    return toTransitionDetail(
      transition,
      await this.assertionRepository.findByTransitionId(transition.id),
    );
  }

  // The shared body of both apply paths. Everything it does happens inside the
  // caller's transaction, starting with the row lock.
  private async applyOneAssertion(
    repositories: NarrativeTransitionRepositories,
    outboxEvents: OutboxEventRepository,
    projectId: string,
    effectId: string,
    requestingUserId: string,
    definitions: ReadonlyMap<string, RelationshipDefinition>,
  ): Promise<AssertionDetail> {
    // ONE clock read per action, and it happens here because the claim itself
    // needs the instant: the same `now` stamps `applied_at` on disk and, further
    // down, the aggregate's `markApplied()`. Two reads could straddle a tick.
    const now = this.clock.now();

    // Step 4b-5. The predicate rides inside the write, so this single statement
    // both takes the row lock and decides whether this caller is the one applying
    // the assertion. It replaces `findByIdForUpdate` + a separate `applied_at` check
    // — the pair whose distance was the thing a reader had to remember.
    const claim = await repositories.assertions.claimForApply(
      projectId,
      effectId,
      now,
    );

    if (claim.status === "missing") {
      throw new AppError(ErrorCode.NOT_FOUND, "Transition assertion not found");
    }

    // The idempotency answer REQUIRED by `flow_10:101,115`: two concurrent
    // applies both saw pending, the loser waited in the row's lock queue, and
    // this is where it finds out. Success rather than 409 is deliberate — the
    // assertion IS applied, which is what the caller asked for; a second
    // ContentRevision is what must not happen.
    if (claim.status === "already-applied") {
      return toEffectDetail(claim.assertion);
    }

    const assertion = claim.assertion;

    if (assertion.operation === "attribute_change") {
      await this.applyAttributeChange(
        repositories,
        outboxEvents,
        assertion,
        requestingUserId,
        now,
      );
    } else {
      await this.applyRelationshipChange(
        repositories,
        outboxEvents,
        assertion,
        requestingUserId,
        now,
        definitions,
      );
    }

    try {
      await repositories.assertions.update(assertion);
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    return toEffectDetail(assertion);
  }

  private async applyAttributeChange(
    repositories: NarrativeTransitionRepositories,
    outboxEvents: OutboxEventRepository,
    assertion: Assertion,
    requestingUserId: string,
    now: Date,
  ): Promise<void> {
    // Decision D3's second half: the allowlist is checked again at apply, not
    // only when the assertion was declared. It is a Phase 7 table over columns that
    // will keep changing, so a field that stops being writable must stop being
    // appliable — while the assertion itself stays readable and deletable
    // (`../../domain/transition/Assertion.ts` create()).
    const domainField =
      assertion.fieldPath === null
        ? null
        : domainAttributeFieldOf(assertion.targetEntityType, assertion.fieldPath);

    if (domainField === null || assertion.newValue === null) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Field ${String(assertion.fieldPath)} is no longer writable by a narrative transition on ${assertion.targetEntityType}`,
      );
    }

    const revisionId = this.idGenerator.generate();

    let applied;
    try {
      applied = await repositories.contentAttributes.applyAttributeChange({
        entityType: assertion.targetEntityType,
        entityId: assertion.targetEntityId,
        domainField,
        newValue: assertion.newValue,
        revisionId,
        changedByUserId: requestingUserId,
        now,
      });
    } catch (error) {
      mapNarrativeTransitionError(error);
    }

    if (applied?.projectId !== assertion.projectId) {
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
      assertion.markApplied({ contentRevisionId: revisionId, now });
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
      aggregateType: assertion.targetEntityType,
      aggregateId: assertion.targetEntityId,
      projectId: assertion.projectId,
      triggeredByUserId: requestingUserId,
      payload: {
        projectId: assertion.projectId,
        entityType: assertion.targetEntityType,
        entityId: assertion.targetEntityId,
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
    assertion: Assertion,
    requestingUserId: string,
    now: Date,
    definitions: ReadonlyMap<string, RelationshipDefinition>,
  ): Promise<void> {
    const narrativeTransitionId = assertion.narrativeTransitionId;
    const relationshipType = assertion.relationshipType;
    const relatedEntityType = assertion.relatedEntityType;
    const relatedEntityId = assertion.relatedEntityId;

    if (
      narrativeTransitionId === null ||
      relationshipType === null ||
      relatedEntityType === null ||
      relatedEntityId === null
    ) {
      // Unreachable through the domain, which refuses to build such an assertion.
      // Kept because the alternative is non-null assertions on three fields, and
      // a stored row that somehow drifted deserves a 500 that says so rather
      // than a TypeError deeper in.
      throw new Error(
        `Relationship assertion ${assertion.id} is missing its relationship fields or its parent transition`,
      );
    }

    // REACHABLE, unlike the guard above, and that is the difference worth
    // naming: declare checked this predicate against the vocabulary, but
    // `assertions.relationship_type` carries no foreign key, so an
    // author who deletes the predicate between declare and apply leaves an
    // assertion pointing at a name their project no longer has. A 400 that names it
    // is the honest answer — the transition is still declarable, and redefining
    // the predicate makes it appliable again.
    const definition = definitions.get(relationshipType);

    if (definition === undefined) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unknown relation type: ${relationshipType}`,
      );
    }

    // WHAT THIS APPLY ACTUALLY WROTE TO THE LOG — as opposed to what was declared.
    // Filled by whichever branch runs and spent by the causality event below.
    //
    // It exists because the two branches write DIFFERENT rows (gerbang 4b-3, F-1):
    // an add IS its own assertion, while a removal writes a separate `terminate`
    // naming the assertion it ends. Until this, the event reported the declared
    // `relationship_remove` and said nothing about the `terminate` — so a consumer
    // could not learn that row existed, let alone the story moment it carries, which
    // is the one thing a valid-time fold cannot be built without.
    //
    // Flat with nulls rather than two shapes: one routing key should mean one payload
    // schema, and a consumer branching on `operation` already knows which half to
    // read. The LOG ROW stays authoritative — the anchor is copied here from the same
    // values in the same transaction, and an e2e assertion pins the copy to the row so
    // the two cannot drift apart in silence.
    const logged: {
      assertionId: string | null;
      terminationId: string | null;
      targetAssertionId: string | null;
      anchorEntityType: string | null;
      anchorEntityId: string | null;
    } = {
      assertionId: null,
      terminationId: null,
      targetAssertionId: null,
      anchorEntityType: null,
      anchorEntityId: null,
    };

    if (assertion.operation === "relationship_add") {
      let relationship: ContentRelationship;
      try {
        // STEP 4b-3: the dual write is gone. This used to build the projection
        // here, from this assertion's fields, while `RelationshipService` built the
        // same projection from its own request — two constructions of one fold.
        // Now both call `foldAssertion()`, which reads the LOG ROW.
        //
        // The assertion row IS the assertion on this path: it is the log entry
        // stating the fact, and applying it is what makes the fact hold. That is
        // why the fold is handed `assertion` — no separate assertion is written, and
        // a generated id would point at a row that does not exist for the
        // composite foreign key to find.
        relationship = foldAssertion({
          id: this.idGenerator.generate(),
          assertion,
          definition,
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

      // Stated even though it equals `effectId`: "this row is the assertion" is a
      // claim about the log, and a consumer should not have to know that this path
      // happens to conflate the two.
      logged.assertionId = assertion.id;
    } else {
      // Decision D4, now behind the shared fold (step 4b-3): the assertion stores
      // endpoints as declared and no row id, so the projection row is found by its
      // natural identity — the canonical orientation of (type, endpoints), which is
      // what the six-column unique index keys on. That identity rule lives in
      // `relationshipProjection.ts` because it is the PROJECTION's rule, and it now
      // has one home instead of two.
      const existing = await findFoldOfFact(repositories.contentRelationships, {
        projectId: assertion.projectId,
        relationType: relationshipType,
        definition,
        subject: {
          entityType: assertion.targetEntityType,
          entityId: assertion.targetEntityId,
        },
        object: { entityType: relatedEntityType, entityId: relatedEntityId },
      });

      // Decision D5, the remove half: the link this assertion would cut is not
      // there. Silently marking it applied would record that this transition
      // severed a relationship it never touched.
      if (existing === undefined) {
        throw new AppError(
          ErrorCode.CONFLICT,
          "The relationship this assertion would remove does not exist",
        );
      }

      // ── STEP 4b-3: THE LOG ENTRY THIS PATH USED TO OMIT ──────────────────────
      //
      // Until now this branch deleted the projection row and wrote NOTHING to the
      // log, so the original `relationship_add` stayed applied and unwithdrawn while
      // its fold vanished. Rebuilding the projection from the log — which is exactly
      // what `GraphProjector` will do at 4b-4 — would have resurrected the
      // relationship. That was the known divergence window (gerbang G1, T-6).
      //
      // What it writes is `terminate`, NOT `retract`, and the choice is the one
      // premis §8.3 left open until a caller could name a story moment: a narrated
      // removal means the fact STOPPED HOLDING at a point in the story, not that it
      // was never true. The anchor comes from the parent transition's source entity
      // — the scene or chapter the author declared this beat on — which is why
      // `terminateFact()` requires it and why this is the only path that may call it.
      const parent = await repositories.narrativeTransitions.findById(
        narrativeTransitionId,
      );

      // Unreachable through the foreign key, which refuses an assertion whose parent is
      // absent. Kept because a row that somehow drifted deserves an error naming the
      // invariant rather than a null dereference.
      if (parent === null) {
        throw new Error(
          `Transition assertion ${assertion.id} names transition ${narrativeTransitionId}, which does not exist`,
        );
      }

      // The fact being ended is the one the PROJECTION points at — not a fact
      // pattern this branch re-derives. Read unnarrowed (`findAssertionById`)
      // because it may be PARENTLESS: a narrative removal is allowed to end a fact
      // the CRUD endpoint asserted (decision 2026-08-19, the A-3 direction), and
      // `findById` cannot see such a row by design.
      const asserted = await repositories.assertions.findAssertionById(
        assertion.projectId,
        existing.sourceAssertionId,
      );

      if (asserted === null) {
        throw new Error(
          `Relationship ${existing.id} points at assertion ${existing.sourceAssertionId}, which does not exist in project ${assertion.projectId}`,
        );
      }

      let termination: Assertion;
      try {
        termination = Assertion.terminateFact({
          id: this.idGenerator.generate(),
          projectId: assertion.projectId,
          narrativeTransitionId,
          target: asserted,
          definition,
          anchorEntityType: parent.sourceEntityType,
          anchorEntityId: parent.sourceEntityId,
          now,
        });
      } catch (error) {
        mapNarrativeTransitionError(error);
      }

      try {
        // Log first, fold second — the same order the CRUD retraction uses. A fold
        // removed before its operation row exists is a fact that disappeared with
        // nothing to explain it, and inside one transaction the order costs nothing.
        await repositories.assertions.insert(termination);
        await repositories.contentRelationships.delete(
          existing.id,
          existing.version,
        );
      } catch (error) {
        mapNarrativeTransitionError(error);
      }

      logged.terminationId = termination.id;
      logged.targetAssertionId = asserted.id;
      logged.anchorEntityType = termination.anchorEntityType;
      logged.anchorEntityId = termination.anchorEntityId;
    }

    try {
      // No revision pointer: a relationship change writes no ContentRevision at
      // all (`16:105`, `flow_10:117`), and the domain refuses one here.
      assertion.markApplied({ now });
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
      eventType: NARRATIVE_ASSERTION_APPLIED,
      eventVersion: 1,
      aggregateType: "narrative_transition",
      aggregateId: narrativeTransitionId,
      projectId: assertion.projectId,
      triggeredByUserId: requestingUserId,
      payload: {
        projectId: assertion.projectId,
        narrativeTransitionId: assertion.narrativeTransitionId,
        effectId: assertion.id,
        operation: assertion.operation,
        relationshipType,
        targetEntityType: assertion.targetEntityType,
        targetEntityId: assertion.targetEntityId,
        relatedEntityType,
        relatedEntityId,
        appliedByUserId: requestingUserId,
        // The rows in the log this apply is reporting. `effectId` above is the
        // INTENT; these are what was written (4b-3, F-1). The CRUD side has carried
        // its equivalents since 4b-2 (`retractionId` + `assertionId` on
        // `content.relationship.retracted`) — two paths in one role should not have
        // two different event contracts.
        ...logged,
      },
      routingKey: NARRATIVE_ASSERTION_APPLIED,
      exchange: "saas.events",
    });
  }

  // Returns null when the assertion is already applied, so the caller can answer
  // idempotently without opening a transaction. Everything it checks is
  // re-checked under the lock — this pass exists to keep the pooled-client reads
  // (locator) out of the transaction, not to replace the authoritative ones.
  private async loadPendingEffectForApply(
    projectId: string,
    effectId: string,
  ): Promise<Assertion | null> {
    const assertion = await this.loadExistingAssertion(projectId, effectId);

    if (assertion.isApplied) {
      return null;
    }

    await this.assertEntityInProject(
      projectId,
      assertion.targetEntityType,
      assertion.targetEntityId,
      "Target",
    );

    if (assertion.relatedEntityType !== null && assertion.relatedEntityId !== null) {
      await this.assertEntityInProject(
        projectId,
        assertion.relatedEntityType,
        assertion.relatedEntityId,
        "Related",
      );
    }

    return assertion;
  }

  private async loadExistingAssertion(
    projectId: string,
    effectId: string,
  ): Promise<Assertion> {
    const assertion = await this.assertionRepository.findById(effectId);

    if (assertion?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Transition assertion not found");
    }

    return assertion;
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
  // the pending assertions.
  private async assertReversible(
    projectId: string,
    reversesTransitionId: string,
  ): Promise<void> {
    const reversed = await this.loadExistingTransition(
      projectId,
      reversesTransitionId,
    );

    const status = deriveNarrativeTransitionStatus(
      await this.assertionRepository.findByTransitionId(reversed.id),
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

  private async withAssertions(
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
          await this.assertionRepository.findByTransitionId(
            transition.id,
          ),
        ),
      );
    }

    return details;
  }
}

// Same class of guard as the one in applyRelationshipChange, and here for the
// same reason: `PrismaAssertionRepository.findById` scopes its query to
// rows that HAVE a parent, so every assertion this service returns has one. The
// type cannot express a repository's scope, and the alternatives are worse — a
// non-null assertion hides the assumption from the compiler, `?? ""` puts a lie
// on the wire, and widening `AssertionDetail` would ask every client to
// handle a case these routes cannot produce. A row that somehow drifted deserves
// a 500 that names it.
//
// Deliberately NOT in the DTO mapper: translation must not have a branch that
// can fail. That mistake was made once already and cut before it ran
// (`notes/phase-11-validation.md` §Domain baru validation).
function toEffectDetail(assertion: Assertion): AssertionDetail {
  const narrativeTransitionId = assertion.narrativeTransitionId;

  if (narrativeTransitionId === null) {
    throw new Error(
      `Transition assertion ${assertion.id} has no parent transition; it is an assertion, not an assertion of this aggregate`,
    );
  }

  return {
    id: assertion.id,
    narrativeTransitionId,
    projectId: assertion.projectId,
    operation: assertion.operation,
    targetEntityType: assertion.targetEntityType,
    targetEntityId: assertion.targetEntityId,
    fieldPath: assertion.fieldPath,
    newValue: assertion.newValue,
    relationshipType: assertion.relationshipType,
    relatedEntityType: assertion.relatedEntityType,
    relatedEntityId: assertion.relatedEntityId,
    appliedAt: assertion.appliedAt,
    contentRevisionId: assertion.contentRevisionId,
    createdAt: assertion.createdAt,
  };
}

function toTransitionDetail(
  transition: NarrativeTransition,
  assertions: readonly Assertion[],
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
    status: deriveNarrativeTransitionStatus(assertions),
    assertions: assertions.map((assertion) => toEffectDetail(assertion)),
    createdAt: transition.createdAt,
    updatedAt: transition.updatedAt,
  };
}

export function createNarrativeTransitionService({
  clock,
  idGenerator,
  narrativeTransitionRepository,
  assertionRepository,
  contentEntityLocator,
  narrativeTransitionUnitOfWork,
  relationshipDefinitionReader,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  narrativeTransitionRepository: NarrativeTransitionRepository;
  assertionRepository: AssertionRepository;
  contentEntityLocator: ContentEntityLocator;
  narrativeTransitionUnitOfWork: NarrativeTransitionUnitOfWork;
  relationshipDefinitionReader: RelationshipDefinitionReader;
}): NarrativeTransitionService {
  return new NarrativeTransitionService(
    clock,
    idGenerator,
    narrativeTransitionRepository,
    assertionRepository,
    contentEntityLocator,
    narrativeTransitionUnitOfWork,
    relationshipDefinitionReader,
  );
}
