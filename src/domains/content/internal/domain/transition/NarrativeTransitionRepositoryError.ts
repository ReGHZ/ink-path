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

// THREE ERRORS THAT DELIBERATELY DO NOT EXIST HERE, so that 7.7 does not add
// them out of symmetry with the relationship errors next door:
//
// No `...ConflictError`. Neither `narrative_transitions` nor
// `transition_effects` has a `version` column
// (`prisma/narrative-transition.prisma:13-60`), so no write is version-guarded
// and no update can match zero rows for a reason other than "gone". Apply is
// serialised by a row lock instead (`TransitionEffectRepository.findByIdForUpdate`),
// which produces waiting, not conflict.
//
// No `...DuplicateError`. There is no unique index on either table beyond the
// primary key — nothing here is deduplicated the way
// `content_relationships` is by its six-column constraint. Two identical effects
// on the same transition are legal: declaring the same consequence twice is a
// writer's mistake, not a corrupt state, and applying the second one after the
// first is caught at apply time by the drift rule (decision D5) rather than by
// an index.
//
// No `...ReferencedError`. The inbound FK that could block a delete —
// `transition_effects.narrative_transition_id`, `onDelete: Restrict` — is
// handled by deleting children first inside the same transaction
// (`16:138`). A Restrict violation therefore means the caller skipped the
// append-only guard or split the two deletes across transactions: a bug to
// surface raw, not a condition to translate into an HTTP status.
