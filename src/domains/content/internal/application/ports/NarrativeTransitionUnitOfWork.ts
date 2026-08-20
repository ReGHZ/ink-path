import type { ContentAttributeMutator } from "./ContentAttributeMutator.js";
import type { OutboxEventRepository } from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { NarrativeTransitionRepository } from "../../domain/transition/NarrativeTransitionRepository.js";
import type { TransitionEffectRepository } from "../../domain/transition/TransitionEffectRepository.js";

// A second unit of work beside `ContentUnitOfWork`, not a widening of it.
// `ContentUnitOfWork<TEntityRepo>` is generic over exactly ONE entity repository
// because a Phase 4-6 write touches one entity table; applying a transition
// effect touches whichever of the nine the effect names, plus
// `transition_effects`, plus either `content_revisions` or
// `content_relationships`. Making the old type carry all of that would have put
// nine repositories into every Character update that needs one.
//
// Everything below is built over the SAME transaction client. That is not a
// convenience: `TransitionEffectRepository.claimForApply()` (step 4b-5) takes
// its row lock as part of the conditional write itself, and that lock only
// lasts as long as the transaction, and every write that follows it — the
// entity mutation, the relationship insert or delete, `applied_at`, the outbox
// row — is serialised by that one claim. A repository built over the pooled
// client here would silently escape it.
export type NarrativeTransitionRepositories = {
  narrativeTransitions: NarrativeTransitionRepository;
  transitionEffects: TransitionEffectRepository;

  // Written by `relationship_add` / `relationship_remove` effects. This is the
  // second writer of `content_relationships` the domain was warned about
  // (`../../domain/support/ContentRelationship.ts:24-27`): it does NOT go
  // through RelationshipService, so the invariants that protect the table have
  // to live in the aggregate, and they do.
  contentRelationships: ContentRelationshipRepository;

  // No `contentRevisions` here, on purpose. An `attribute_change` writes its
  // revision through the mutator below, which is the only thing that knows the
  // per-type snapshot shape and the version the revision number derives from.
  // Exposing the revision repository too would invite a second, differently
  // shaped revision to be written from this layer.
  contentAttributes: ContentAttributeMutator;
};

export type NarrativeTransitionUnitOfWork = {
  transaction<T>(
    work: (
      repositories: NarrativeTransitionRepositories,
      outboxEvents: OutboxEventRepository,
    ) => Promise<T>,
  ): Promise<T>;
};
