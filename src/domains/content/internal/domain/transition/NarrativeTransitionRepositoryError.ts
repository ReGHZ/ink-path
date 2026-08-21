// One shared error type for both repositories of this sub-area: a guarded write
// matched no row (P2025). Same meaning as
// `ContentRelationshipRepositoryNotFoundError` — the service turns it into 404
// rather than letting a delete of a vanished row report success.
//
// Shared rather than split per table on purpose: the service always knows which
// call it just made, so two classes would carry no information the call site
// does not already have, and the alternative — one file per repository — would
// be two files with one identical class each.
export class NarrativeTransitionRepositoryNotFoundError extends Error {
  constructor() {
    super("Narrative transition repository target not found");
    this.name = "NarrativeTransitionRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Step 4b-5. The FK refused to delete a transition because a child assertion
// survived — applied while the delete was working, or born after the delete read
// its list. Named after the FACT rather than after Postgres's code, because the
// service answers it with the same sentence its own per-child guard uses: one
// condition must not have two status codes depending on which of two racing paths
// noticed it (the shape gate 7.7 rejected, measured again at 4b-5 mutan M3).
//
// It exists now and did not before for a concrete reason: until 4b-5 the
// aggregate-root lock made this unreachable, so the adapter deliberately let it
// surface raw as a bug signal. The replacement mechanism makes it a legitimate
// outcome of a race, so it needs a name and an answer.
export class NarrativeTransitionRepositoryChildSurvivedError extends Error {
  constructor() {
    super("Narrative transition still has a child assertion");
    this.name = "NarrativeTransitionRepositoryChildSurvivedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// TWO ERRORS THAT DELIBERATELY DO NOT EXIST HERE, so that 7.7 does not add them
// out of symmetry with the relationship errors next door. A third one used to
// live in this list — see the note below the pair.
//
// No `...ConflictError`. Neither `narrative_transitions` nor
// `assertions` has a `version` column
// (`prisma/narrative-transition.prisma:13-60`), so no write is version-guarded
// and no update can match zero rows for a reason other than "gone". Apply is
// serialised by a claim on the row instead (`AssertionRepository.claimForApply`,
// step 4b-5), which produces waiting, not conflict.
//
// No `...DuplicateError`. There is no unique index on either table beyond the
// primary key — nothing here is deduplicated the way
// `content_relationships` is by its six-column constraint. Two identical assertions
// on the same transition are legal: declaring the same consequence twice is a
// writer's mistake, not a corrupt state, and applying the second one after the
// first is caught at apply time by the drift rule (decision D5) rather than by
// an index.
//
// `...ReferencedError` used to belong on this list, and does not any more:
// `NarrativeTransitionRepositoryChildSurvivedError` above IS that error. Until
// step 4b-5 the aggregate-root lock made a surviving child unreachable at
// delete time, so a P2003 here could only mean a caller had skipped the
// append-only guard, and it was left raw on purpose as that bug signal. 4b-5
// removed the lock and put the FK in its place, which turned the same P2003
// into a legitimate outcome of a race rather than a caller bug — so it now
// gets a name and a translated status instead of surfacing raw.
