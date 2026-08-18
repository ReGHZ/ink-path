import type { OutboxEventRepository } from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { TransitionEffectRepository } from "../../domain/transition/TransitionEffectRepository.js";

// A third unit of work, and the reason is a change of shape rather than a new
// domain: until step 4b a relationship write was ONE statement, so
// RelationshipService deliberately had no transaction at all
// (`../support/RelationshipService.ts`). Since 4b it is two — the assertion that
// records the fact, and the projection row folded from it — and they must land
// together or the log and its projection disagree.
//
// Not a reuse of `NarrativeTransitionUnitOfWork`: that one carries nine entity
// repositories plus the attribute mutator, because applying an effect can touch
// any of them. A relationship write touches exactly the two below, and handing
// this path the other eleven would let a future edit reach for one.
export type RelationshipRepositories = {
  // The assertion log. `transition_effects` by table name still, which the
  // rename scheduled with the migration collapse will fix — the rows written
  // here have no transition.
  assertions: TransitionEffectRepository;

  // The CRUD projection, folded from the assertion INSIDE this transaction.
  // Synchronous on purpose: this is the table the relationship API reads back,
  // so a fold that lagged would make a successful POST followed by a GET answer
  // "not there". The rule-engine projection (`evaluation_nodes`/`_edges`) is the
  // asynchronous one — it has no read-your-writes requirement, and it is built
  // by the projector from the outbox event this transaction also writes.
  contentRelationships: ContentRelationshipRepository;
};

export type RelationshipUnitOfWork = {
  transaction<T>(
    work: (
      repositories: RelationshipRepositories,
      outboxEvents: OutboxEventRepository,
    ) => Promise<T>,
  ): Promise<T>;
};
