import type { Assertion } from "./Assertion.js";

// Three outcomes rather than a boolean plus a follow-up read at every call site:
// "nobody has this row" and "somebody applied it first" are different answers to
// the caller (404 vs idempotent success), and deciding which one it is requires a
// read the adapter has already done.
export type AssertionClaim =
  | { status: "claimed"; assertion: Assertion }
  | { status: "already-applied"; assertion: Assertion }
  | { status: "missing" };

export type AssertionDeletion = "deleted" | "applied" | "missing";

export type AssertionRepository = {
  // Unscoped read, then the service compares `projectId` — same 404-not-403 rule
  // as everywhere else in this domain. The assertion carries its own `project_id`
  // (denormalised from the parent, `16:95`), so the comparison needs no join.
  findById(id: string): Promise<Assertion | null>;

  // The SAME read WITHOUT the parent-transition narrowing, added in step 4b-2.
  //
  // `findById` above is deliberately narrowed to rows that have a parent, which
  // is what makes it a read of the Phase 7 AGGREGATE rather than of the table.
  // An assertion written straight through relationship CRUD has no parent, so
  // that read cannot see it — and an operation (`retract`/`terminate`) has to,
  // because it must point at the row's real `operation` rather than at a kind
  // its caller merely believes (C-1).
  //
  // Project-scoped in the signature rather than compared afterwards, because
  // every caller is already inside a transaction acting on one project's log, and
  // an unscoped read here would be one `if` away from a tenancy leak in a path
  // whose whole job is to write a row the composite FK would then refuse.
  findAssertionById(
    projectId: string,
    id: string,
  ): Promise<Assertion | null>;

  // Step 4b-5. The apply path's FIRST statement, and the replacement for the
  // pessimistic read lock below: the predicate travels INSIDE the write, so the
  // row lock is taken by the statement that changes the row and the predicate is
  // re-evaluated against the committed version after any wait (READ COMMITTED,
  // EvalPlanQual). One statement, therefore no distance between "we looked" and
  // "we wrote" for a human to forget to close.
  //
  // This is NOT the retracted claim that a unique constraint could stand in for
  // the lock (B-1, `notes/premis-symbolic-rule-engine.md` §8.1): a constraint
  // makes nobody wait and has no order, whereas a conditional write waits in the
  // row's own lock queue exactly as `FOR UPDATE` did.
  //
  // Sound here only because `applied_at` is MONOTONE — append-only, and a
  // reversal adds a fact rather than clearing the column
  // (`notes/jangan-diregresi.md:65`). The day it can be reset, the post-failure
  // read below stops being stable and this shape goes with it.
  //
  // `claimed` hands the row back in its PRE-CLAIM shape on purpose: the row on
  // disk already carries the claim, but the aggregate stays pending so
  // `markApplied()` remains the single place that decides an assertion is applied,
  // with the same `now` the claim used.
  claimForApply(
    projectId: string,
    id: string,
    now: Date,
  ): Promise<AssertionClaim>;

  // The delete twin of the claim, step 4b-5. `applied` is the answer only after
  // the delete has WAITED for whatever holds that row: zero rows removed means
  // the predicate failed against the committed version, not that the caller
  // named a row nobody has.
  deleteIfPending(
    projectId: string,
    id: string,
  ): Promise<AssertionDeletion>;

  // Every assertion of one transition, in `createdAt` asc with `id` asc as
  // tie-break. Backed by `@@index([narrativeTransitionId])`
  // (`prisma/narrative-transition.prisma:56`).
  //
  // This is what derived status is computed from — there is no status column to
  // read (`16:71-75`), so a transition's status costs this list. It is also what
  // the append-only guard reads before deleting a transition, and what bulk
  // apply (decision D9) iterates over. Returns aggregates rather than a count of
  // applied rows for the same reason `findByEntity` beat `countByEntity` at the
  // 7.1 gate: every caller needs the rows themselves anyway.
  findByTransitionId(transitionId: string): Promise<Assertion[]>;

  insert(assertion: Assertion): Promise<void>;

  // Writes `applied_at` + `content_revision_id`. Those are the only mutable
  // columns on this table — an assertion's intent is immutable, and changing one
  // means deleting the pending assertion and declaring another
  // (Flow 10 has no update endpoint for assertions, only add and delete).
  //
  // Unguarded by version, and that is not the oversight it looks like: this
  // table has no `version` column and does not need one, because since step 4b-5
  // the write only ever happens inside the transaction whose `claimForApply()`
  // already holds this row's lock. The CLAIM is the serialisation. Calling this
  // outside that transaction loses the guarantee.
  update(assertion: Assertion): Promise<void>;


};
