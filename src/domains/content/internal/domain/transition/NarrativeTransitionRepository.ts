import type {
  NarrativeTransition,
  NarrativeTransitionSourceType,
} from "./NarrativeTransition.js";

export type NarrativeTransitionRepository = {
  // Not scoped by project, exactly like `ContentRelationshipRepository.findById`
  // and `SceneRepository.findById`: the row comes back and the service compares
  // `projectId` itself, so a transition in another project answers 404 and never
  // 403 — the API must not confirm that another tenant's row exists.
  findById(id: string): Promise<NarrativeTransition | null>;

  // `SELECT ... FOR UPDATE` on the transition row. This is the AGGREGATE ROOT
  // lock, and it protects something the per-effect locks cannot: the SET of
  // children.
  //
  // The hole it closes, found at the 7.7 gate: deleting a transition locks every
  // effect it reads and then issues one blanket `DELETE ... WHERE
  // narrative_transition_id = ?`. A concurrent `addEffect` needs no lock at all,
  // so a child born after that read is never inspected — and if it is applied in
  // between, the blanket statement destroys an applied fact
  // (`05-implementation-policy/05_append_only_invariants.md:53-60`), leaving an
  // orphan ContentRevision and outbox event behind. Waiting on a row lock cannot
  // help there: the row did not exist when the locks were taken.
  //
  // Both structural operations therefore take this lock — deleteTransition and
  // addEffect — which serialises "which effects exist" against "delete them
  // all". Apply deliberately does NOT take it: it changes an effect's state, not
  // the set, and making every apply queue behind the root would serialise a
  // transition's whole fan-out for no invariant.
  //
  // MUST run inside a transaction, same as
  // `TransitionEffectRepository.findByIdForUpdate` — outside one the lock is
  // released the moment the statement returns, silently.
  findByIdForUpdate(id: string): Promise<NarrativeTransition | null>;

  // Project-scoped list. Scoping lives HERE rather than in the caller, for the
  // same reason it does on the relationship list reads: the wrong tenant has to
  // receive an empty list, not a comparison the caller could forget to make.
  //
  // Ordering is part of the contract, not the adapter's choice: `createdAt` desc
  // with `id` asc as tie-break — newest first, because the panel that reads this
  // shows what just happened in the story, and stable under equal timestamps so
  // tests are reproducible. No pagination yet; deliberately left until a real
  // need appears, same call the 7.1 gate made for relationship lists.
  findByProjectId(projectId: string): Promise<NarrativeTransition[]>;

  // "What happened in this scene?" — the query the consequences panel in the
  // Scene/Event/Chapter editor is built on. Backed by
  // `@@index([projectId, sourceEntityType, sourceEntityId])`
  // (`prisma/narrative-transition.prisma:33`), which exists for exactly this and
  // nothing else. Same ordering contract as above.
  findBySourceEntity(
    projectId: string,
    sourceEntityType: NarrativeTransitionSourceType,
    sourceEntityId: string,
  ): Promise<NarrativeTransition[]>;

  insert(narrativeTransition: NarrativeTransition): Promise<void>;

  // Title and description only — everything else on this aggregate is immutable
  // (`NarrativeTransition.updateDetails`). Unguarded on purpose: this table has
  // no `version` column, so there is no optimistic concurrency to enforce and
  // last-write-wins is the accepted behaviour for two human labels. Do not
  // extend this method to carry state; `applied_at` lives on the child, under a
  // row lock.
  update(narrativeTransition: NarrativeTransition): Promise<void>;

  // Hard delete, allowed ONLY when every child effect is still pending
  // (`05-implementation-policy/05_append_only_invariants.md:52-59`). Two things
  // the caller owns, neither of which this method can check for itself:
  //
  // 1. The append-only guard — read the children, refuse with 409 if any is
  //    applied. The database will not help: the FK on `transition_effects` is
  //    `onDelete: Restrict` (`prisma/narrative-transition.prisma:54`), which
  //    blocks a delete while ANY child exists, applied or not, and cascade was
  //    switched off precisely so that the rule stays app-decided
  //    (`16:145-148`).
  // 2. The ordering — children first, then the parent, in ONE transaction
  //    (`16:138`). A Restrict violation here surfaces raw: it means the caller
  //    skipped step 1 or ran the two deletes in separate transactions, which is
  //    a bug in the caller, not a user-facing condition.
  //
  // Throws NarrativeTransitionRepositoryNotFoundError when the row is already
  // gone (P2025), so the service can answer 404 instead of a silent success.
  delete(id: string): Promise<void>;
};
