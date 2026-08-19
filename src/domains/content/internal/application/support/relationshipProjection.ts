import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import {
  canonicalizeEndpoints,
  type RelationEndpoint,
  type RelationshipDefinition,
} from "../../domain/support/relationshipDefinition.js";

import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { TransitionEffect } from "../../domain/transition/TransitionEffect.js";

// THE FOLD — `content_relationships` derived from a row in the assertion log.
//
// STEP 4b-3, and the dual write it ends. Until now two places built this
// projection: `RelationshipService.createRelationship` from its own request input,
// and `NarrativeTransitionService.applyRelationshipChange` from an effect row. Both
// went through `ContentRelationship.create()`, so neither could store a row the
// other would refuse — but they read DIFFERENT sources for the same fact, which is
// exactly what `07-implementation-order/01` §Langkah 4 butir 3 calls "jalur tulis
// lama" and what premis §8.4 rules out: a projection has one fold, not one per
// caller.
//
// What changes materially, not just structurally: the fold now reads the LOG ROW.
// The CRUD path used to project its request while separately asserting it, so the
// two could disagree about the same fact (endpoints, predicate, timestamp) with
// nothing to catch it. Here the assertion is the only input, so the projection
// cannot say anything the log does not.
export function foldAssertion(props: {
  id: string;
  // The log row being folded. `relationship_add` — an `assertFact()` from CRUD or an
  // applied narrative effect; both are assertions of the same shape, which is the
  // whole reason one function can serve both.
  assertion: TransitionEffect;
  // The project's row for the predicate the assertion names. Resolved by the caller,
  // like everywhere else in this domain, so the fold stays free of I/O.
  definition: RelationshipDefinition;
  note?: string | null;
  createdByUserId: string;
  now: Date;
}): ContentRelationship {
  const relationType = props.assertion.relationshipType;
  const relatedEntityType = props.assertion.relatedEntityType;
  const relatedEntityId = props.assertion.relatedEntityId;

  // Unreachable through either factory — `assertFact()` and `create()` both refuse a
  // relationship row with these unset. Kept because the alternative is three
  // non-null assertions, and a stored row that somehow drifted deserves an error
  // naming the invariant instead of a TypeError one layer down.
  if (
    relationType === null ||
    relatedEntityType === null ||
    relatedEntityId === null
  ) {
    throw new Error(
      `Assertion ${props.assertion.id} is missing the relationship fields a projection needs`,
    );
  }

  // ENDPOINTS AS THE LOG STORES THEM: `target_entity_*` is the subject, the
  // `related_entity_*` pair is the object. Not canonicalised here on purpose —
  // `ContentRelationship.create()` owns that, because the canonical orientation is
  // the PROJECTION's identity (the six-column unique index), while the log keeps
  // endpoints as the writer declared them.
  return ContentRelationship.create({
    id: props.id,
    projectId: props.assertion.projectId,
    relationType,
    definition: props.definition,
    source: {
      entityType: props.assertion.targetEntityType,
      entityId: props.assertion.targetEntityId,
    },
    target: { entityType: relatedEntityType, entityId: relatedEntityId },
    // The fold names the fact it was folded from — the pointer that makes
    // `retract`/`terminate` able to find this row, and the FK that stops a
    // projection from outliving its assertion.
    sourceAssertionId: props.assertion.id,
    note: props.note,
    createdByUserId: props.createdByUserId,
    now: props.now,
  });
}

// The projection row for a fact stated by (predicate, subject, object) — the fold's
// identity rather than its id.
//
// Needed because a `relationship_remove` effect names ENDPOINTS, not a row: the
// author declares "Aria leaves the Silver Hand", not "delete row 7". Decision D4
// (`notes/phase-7-narrative-transition.md`) settled that this lookup keys on the
// canonical orientation of (type, endpoints), which is what the six-column unique
// index keys on — so the answer is unique when it exists.
//
// `findByEntity` is reused rather than a new `findByEndpoints` added: it is already
// indexed from both sides and it returns the aggregate, which carries the `version`
// the guarded delete needs. Lives here rather than in the service because it encodes
// the PROJECTION's identity rule, and 4b-3's whole point is that this rule has one
// home.
export async function findFoldOfFact(
  contentRelationships: ContentRelationshipRepository,
  fact: {
    projectId: string;
    relationType: string;
    definition: RelationshipDefinition;
    subject: RelationEndpoint;
    object: RelationEndpoint;
  },
): Promise<ContentRelationship | undefined> {
  const { source, target } = canonicalizeEndpoints(
    fact.definition.directionality,
    fact.subject,
    fact.object,
  );

  const candidates = await contentRelationships.findByEntity(
    fact.projectId,
    fact.subject.entityType,
    fact.subject.entityId,
  );

  return candidates.find(
    (candidate) =>
      candidate.relationType === fact.relationType &&
      candidate.sourceEntityType === source.entityType &&
      candidate.sourceEntityId === source.entityId &&
      candidate.targetEntityType === target.entityType &&
      candidate.targetEntityId === target.entityId,
  );
}
