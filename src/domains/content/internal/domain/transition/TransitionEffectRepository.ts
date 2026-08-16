import type { TransitionEffect } from "./TransitionEffect.js";

export type TransitionEffectRepository = {
  // Unscoped read, then the service compares `projectId` — same 404-not-403 rule
  // as everywhere else in this domain. The effect carries its own `project_id`
  // (denormalised from the parent, `16:95`), so the comparison needs no join.
  findById(id: string): Promise<TransitionEffect | null>;

  // The apply path's first statement, and the only pessimistic lock in Phase 7.
  // `SELECT ... FOR UPDATE` on the effect row, then re-read `applied_at` inside
  // the same transaction (`flow_10:101,115`, `16:154`). Without it two
  // concurrent applies both see `applied_at IS NULL` and each writes its own
  // ContentRevision, or mutates the graph twice.
  //
  // `06_concurrency_control_policy.md` reserves pessimistic locks for rare,
  // critical operations and names Narrative Transition apply as one of them —
  // which is also why 7.4b, whose delete guard is neither rare nor critical,
  // deliberately went the other way and accepted the race.
  //
  // MUST be called inside a transaction: outside one, Postgres releases the lock
  // the moment the statement returns and the guarantee above evaporates
  // silently, with no error to notice. The adapter is therefore built over the
  // transaction client, never the pooled one.
  findByIdForUpdate(id: string): Promise<TransitionEffect | null>;

  // Every effect of one transition, in `createdAt` asc with `id` asc as
  // tie-break. Backed by `@@index([narrativeTransitionId])`
  // (`prisma/narrative-transition.prisma:56`).
  //
  // This is what derived status is computed from — there is no status column to
  // read (`16:71-75`), so a transition's status costs this list. It is also what
  // the append-only guard reads before deleting a transition, and what bulk
  // apply (decision D9) iterates over. Returns aggregates rather than a count of
  // applied rows for the same reason `findByEntity` beat `countByEntity` at the
  // 7.1 gate: every caller needs the rows themselves anyway.
  findByTransitionId(transitionId: string): Promise<TransitionEffect[]>;

  insert(transitionEffect: TransitionEffect): Promise<void>;

  // Writes `applied_at` + `content_revision_id`. Those are the only mutable
  // columns on this table — an effect's intent is immutable, and changing one
  // means deleting the pending effect and declaring another
  // (Flow 10 has no update endpoint for effects, only add and delete).
  //
  // Unguarded by version, and that is not the oversight it looks like: this
  // table has no `version` column, and it does not need one, because the write
  // only ever happens inside the transaction that already holds the row lock
  // from findByIdForUpdate(). The lock IS the serialisation. Calling this
  // outside that transaction loses the guarantee — see the note above.
  update(transitionEffect: TransitionEffect): Promise<void>;

  // Pending effects only; the caller must have checked `isApplied` first
  // (`05_append_only_invariants.md:52-59`). Nothing in the database enforces
  // that — `applied_at` is an ordinary nullable timestamp with no trigger — so
  // this method will happily delete applied history if handed the wrong id.
  //
  // Throws NarrativeTransitionRepositoryNotFoundError when the row is already
  // gone (P2025).
  delete(id: string): Promise<void>;

  // The child half of deleting a fully-pending transition, run in the same
  // transaction as the parent delete (`16:138`). One statement rather than a
  // loop over delete(): the loop would need a second round-trip per effect and
  // would have to invent a policy for "one child was already gone" that the
  // parent delete does not care about.
  //
  // Same caveat as delete(): it does not look at `applied_at`. The guard belongs
  // to the caller, which has already read the children to derive the status.
  deleteByTransitionId(transitionId: string): Promise<void>;
};
