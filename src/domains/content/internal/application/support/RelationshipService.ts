import { foldAssertion } from "./relationshipProjection.js";
import {
  CONTENT_RELATIONSHIP_ASSERTED,
  CONTENT_RELATIONSHIP_RETRACTED,
} from "../../../../../shared/application/events/routingKeys.js";
import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import {
  ContentRelationshipRepositoryConflictError,
  ContentRelationshipRepositoryDuplicateError,
  ContentRelationshipRepositoryNotFoundError,
} from "../../domain/support/ContentRelationshipRepositoryError.js";
import { TransitionEffect } from "../../domain/transition/TransitionEffect.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type {
  RelationDirectionality,
  RelationshipDefinition,
} from "../../domain/support/relationshipDefinition.js";
import type {
  ContentEntityLocation,
  ContentEntityLocator,
} from "../ports/ContentEntityLocator.js";
import type { RelationshipDefinitionReader } from "../ports/RelationshipDefinitionReader.js";
import type { RelationshipUnitOfWork } from "../ports/RelationshipUnitOfWork.js";

export type CreateRelationshipInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  projectId: string;
  sourceEntityType: ContentEntityType;
  sourceEntityId: string;
  targetEntityType: ContentEntityType;
  targetEntityId: string;
  // Plain `string`, not `RelationType`: Rule 1 belongs to the domain, so the
  // wire value is handed to `ContentRelationship.create()` unnarrowed and both
  // entry paths (this service and 7.7) get the same rejection
  // (`ContentRelationship.ts:48-54`). Entity types stay narrowed because they
  // arrive as route constants, never as free text.
  relationType: string;
  note?: string | null;
};

export type UpdateRelationshipNoteInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  note: string | null;
};

export type DeleteRelationshipInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
};

// `version` is deliberately absent. It is not withheld from the client as a
// courtesy — it must not travel at all: Flow 4 §Delete (FROZEN 2026-08-14)
// rules that `expectedVersion` never crosses the wire, and the service reads it
// from the row it just loaded. Publishing it here would invite a future
// `If-Match` that contradicts the frozen decision.
export type RelationshipDetail = {
  id: string;
  projectId: string;
  sourceEntityType: ContentEntityType;
  sourceEntityId: string;
  targetEntityType: ContentEntityType;
  targetEntityId: string;
  relationType: string;
  // Carried on the detail because the vocabulary is data now: the interface
  // layer still decides WHICH label a perspective sees (§7.5), but the symbol
  // and the directionality it picks from are rows, and only the application
  // layer may read rows. Undefined never happens for a row that satisfies the
  // `(project_id, relation_type)` foreign key — it is here so a definition
  // deleted between the two reads degrades to a verbatim label instead of a 500.
  directionality?: RelationDirectionality;
  inverseLabel?: string;
  note: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ONE write guard for create, update AND delete — no `assertCanDelete` twin,
// which is the deliberate difference from every Phase 4-6 content service.
// Flow 4 says so twice (`02-system-design/03_flow_04_content_relationship.md:17`
// and `:159`): an Editor may delete a relationship WITHOUT `can_delete`,
// because cutting a link is not destroying content — both entities survive
// untouched, and there is no revision history to lose.
function assertCanWrite(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Reviewer role cannot modify relationships",
    );
  }
}

// "Does not exist" and "exists in another project" answer the SAME 404, and the
// message names neither condition: distinguishing them would turn this endpoint
// into an existence oracle for other tenants' entities (Flow 4 §Create error
// path, `:52`, and notes K3). 403 would be the same leak in a different code.
function assertEntityInProject(
  location: ContentEntityLocation | null,
  projectId: string,
  subject: string,
): void {
  if (location?.projectId !== projectId) {
    throw new AppError(ErrorCode.NOT_FOUND, `${subject} entity not found`);
  }
}

function mapRelationshipError(error: unknown): never {
  if (error instanceof ContentRelationshipRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Relationship not found");
  }

  // Two 409s that must not collapse into one message. The repository keeps the
  // errors apart (`ContentRelationshipRepositoryError.ts:1-37`) precisely so
  // this layer can tell the caller which of the two happened, and Flow 4 lists
  // them as separate error paths: a duplicate is deterministic and the user
  // fixes it by not re-adding the link, a version conflict is transient and the
  // user fixes it by retrying.
  if (error instanceof ContentRelationshipRepositoryDuplicateError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "This relationship already exists — for a non-directional relation type the same pair in reverse is the same relationship",
    );
  }

  if (error instanceof ContentRelationshipRepositoryConflictError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Relationship was modified concurrently",
    );
  }

  // Generic catch, same as mapCharacterError (`../story/CharacterService.ts:155-159`):
  // every DomainError out of ContentRelationship is a Flow 4 "400 Domain
  // validation error" by definition — unknown relation type, disallowed pair,
  // self-relationship, dedicated hierarchy. Without this branch errorHandler.ts
  // only special-cases AppError, so "unknown relation type" would reach the
  // client as a raw 500 instead of the 400 the flow specifies.
  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

// No ContentUnitOfWork here, unlike every Phase 4-6 content service: a
// relationship write produces no `content_revisions` row, because it changes no
// entity's content and so nothing is re-indexed (notes §3).
//
// CORRECTED 2026-08-19 (gerbang G1, T-4). The rest of that sentence used to read
// "and no outbox event … each operation is a single statement, so there is no
// multi-write atomicity to protect". BOTH halves died with step 4b:
// `createRelationship` writes assertion + fold + `content.relationship.asserted`
// in ONE transaction, and `deleteRelationship` writes retraction + fold-removal +
// `content.relationship.retracted` in another. What stands in for
// ContentUnitOfWork is `relationshipUnitOfWork`, not the absence of one. Kept as
// a correction rather than deleted because two other files cited this comment as
// their source (`register.ts`, `../transition/NarrativeTransitionService.ts`).
//
// ACCEPTED RISK, and what that transaction does NOT close: create is still a
// check-then-act across two connections. Between `locate()` and `insert()` a
// concurrent delete of either endpoint leaves a relationship row pointing at an
// entity that no longer exists, and NOTHING catches it afterwards — this table
// references entities polymorphically, with no FK, so there is no P2003 backstop
// like the one that turns the same race into a 404 for Layer/WorldMap parents
// (`../world/LayerService.ts:140-147`). A transaction would not close it either:
// entity-delete reads relationships while relationship-create reads entities, so
// the two take their locks in opposite order. This is the mirror image of the
// window `notes/phase-7-content-relationship.md:467-471` flags for item 7.4b —
// "jangan diasumsikan rapat" — and it is deliberately left open here rather than
// patched per-side, because the two halves must be decided together in 7.4b
// (accept and document, or a pessimistic lock, which
// `05-implementation-policy/06_concurrency_control_policy.md` reserves for rare,
// critical operations). Until then, the orphan is silent and the guard is
// best-effort.
//
// That does not close the door on 7.7 (NarrativeTransition `relationship_add`/
// `relationship_remove`, which must write inside the transition's transaction,
// notes §5): repositories in this codebase are built per client, so 7.7
// constructs a RelationshipService over the transaction's repository instead of
// this one. No batch API and no optional-repository parameter is invented here
// for a caller that does not exist yet.
export class RelationshipService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly contentRelationshipRepository: ContentRelationshipRepository,
    private readonly contentEntityLocator: ContentEntityLocator,
    private readonly relationshipDefinitionReader: RelationshipDefinitionReader,
    private readonly relationshipUnitOfWork: RelationshipUnitOfWork,
  ) { }

  async createRelationship(
    input: CreateRelationshipInput,
  ): Promise<RelationshipDetail> {
    assertCanWrite(input.requestingMembership);

    // Rules 5, 6 and 7 in two calls — existence and project ownership are the
    // same question for a polymorphic endpoint, so `locate()` answers both at
    // once. Issued together because neither depends on the other; the checks
    // are still REPORTED source-first, so the error a caller sees is
    // deterministic when both endpoints are wrong (Flow 4 steps 5 then 6).
    const [source, target] = await Promise.all([
      this.contentEntityLocator.locate({
        entityType: input.sourceEntityType,
        entityId: input.sourceEntityId,
      }),
      this.contentEntityLocator.locate({
        entityType: input.targetEntityType,
        entityId: input.targetEntityId,
      }),
    ]);

    assertEntityInProject(source, input.projectId, "Source");
    assertEntityInProject(target, input.projectId, "Target");

    // Rule 1, and the one place it can be answered: the vocabulary belongs to
    // the project, so "no such predicate" is a fact about THIS project's rows.
    // A 400 rather than a 404 — the request is fixable by the author, either by
    // correcting the name or by defining the predicate, and 404 would claim the
    // relationship endpoint does not exist.
    const definition = await this.relationshipDefinitionReader.findByPredicate(
      input.projectId,
      input.relationType,
    );

    if (definition === null) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unknown relation type: ${input.relationType}`,
      );
    }

    // Wrapped construction, the Phase 6 invariant "`X.create()` wajib di dalam
    // try/catch": create() carries rules 1, 3, 4, 9, 10, 11 and arity, all of
    // which are caller-fixable 400s rather than bugs.
    //
    // TWO aggregates are built before anything is written, and the order is not
    // arbitrary: the assertion is the FACT and the relationship row is a FOLD of
    // it, so the fold must not be able to succeed against an assertion the
    // domain would have refused.
    // ONE clock read for ONE action (gerbang G1, T-7): the assertion and the fold
    // it feeds must carry the same instant. Two `clock.now()` calls can straddle a
    // tick, and the result would be a projection whose `created_at` disagrees with
    // the fact it projects — a divergence nothing downstream could explain.
    const now = this.clock.now();

    let assertion: TransitionEffect;
    let relationship: ContentRelationship;
    try {
      // Endpoints as DECLARED, not canonicalised — the log's existing
      // convention, set by the narrative writer and argued in
      // `TransitionEffect.validateRelationshipChange()`: `target_entity_*` is
      // indexed as "which entity does this effect touch". Canonical order
      // belongs to the row's IDENTITY, which is the projection's business, and
      // `ContentRelationship.create()` applies it there.
      assertion = TransitionEffect.assertFact({
        id: this.idGenerator.generate(),
        narrativeTransitionId: null,
        projectId: input.projectId,
        effectType: "relationship_add",
        targetEntityType: input.sourceEntityType,
        targetEntityId: input.sourceEntityId,
        relationshipType: input.relationType,
        definition,
        relatedEntityType: input.targetEntityType,
        relatedEntityId: input.targetEntityId,
        now,
      });

      // THE FOLD, and since step 4b-3 it is the SAME function the narrative apply
      // path calls (`relationshipProjection.ts`). It reads the assertion rather
      // than this request: the projection can no longer say anything the log does
      // not, and there is no second construction site to drift from this one.
      relationship = foldAssertion({
        id: this.idGenerator.generate(),
        assertion,
        definition,
        note: input.note,
        createdByUserId: input.requestingUserId,
        now,
      });
    } catch (error) {
      mapRelationshipError(error);
    }

    // One transaction, and it replaces the "no unit of work here" note this
    // service used to carry: the write is two statements now, and an assertion
    // whose projection never landed would be a fact the API cannot see.
    //
    // Still no duplicate lookup before the insert, and none may be added: the
    // domain canonicalised the endpoints, so the six-column unique index catches
    // `A↔B` and `B↔A` alike and surfaces as a Duplicate error (Flow 4 step 8,
    // superseded 2026-08-14). The rollback takes the assertion with it, so a
    // rejected duplicate leaves no orphan fact.
    try {
      await this.relationshipUnitOfWork.transaction(
        async (repositories, outboxEvents) => {
          await repositories.assertions.insert(assertion);
          await repositories.contentRelationships.insert(relationship);

          // Written now, consumed by `GraphProjector` later (item 11.4). The
          // precedent is `narrative.effect.applied`, produced since 7.7 with no
          // consumer on purpose: what is not recorded today cannot be
          // reconstructed later.
          //
          // ⚠ CORRECTED 2026-08-19 (gerbang G1, T-1 + A-1). This used to claim the
          // `content.` prefix "matches the binding the one existing consumer
          // already uses". IT DOES NOT, and no binding today matches this key. The
          // exchange is a TOPIC exchange (`infrastructure/queue/publisher.ts`,
          // `assertExchange(…, "topic")`), where `*` stands for EXACTLY ONE word:
          // the embedding worker binds `content.*`
          // (`infrastructure/embedding/embeddingWorkerConsumer.ts`), which cannot
          // match a three-word key. Harmless today — nothing consumes this event —
          // and matching would in fact be WORSE: the worker casts the routing key
          // to `ContentEventType` and an unmatched value goes straight to the DLQ.
          //
          // TWO CONSEQUENCES, both binding on 4b-4. (1) The binding
          // `GraphProjector` gets must be DECIDED (`content.#` / `narrative.#`, or
          // explicit keys) and must cover all three keys that exist:
          // `content.relationship.asserted`, `content.relationship.retracted`,
          // `narrative.effect.applied`. (2) Do NOT shorten this key to two words
          // hoping a binding picks it up — that is exactly what would feed the
          // embedding worker garbage.
          await outboxEvents.insert({
            id: this.idGenerator.generate(),
            eventType: CONTENT_RELATIONSHIP_ASSERTED,
            eventVersion: 1,
            aggregateType: "content_relationship",
            aggregateId: relationship.id,
            projectId: input.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: input.projectId,
              assertionId: assertion.id,
              relationshipId: relationship.id,
              predicate: input.relationType,
            },
            routingKey: CONTENT_RELATIONSHIP_ASSERTED,
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapRelationshipError(error);
    }

    return toRelationshipDetail(relationship, definition);
  }

  // No role guard on either read: Flow 4 §Read Relation step 3 — every role,
  // Reviewer included, may read relationships. Membership itself is already
  // enforced upstream by the project-scoped router (6.5).
  async getRelationshipById(
    projectId: string,
    relationshipId: string,
  ): Promise<RelationshipDetail> {
    const relationship = await this.loadExistingRelationship(
      projectId,
      relationshipId,
    );

    const definition = await this.relationshipDefinitionReader.findByPredicate(
      projectId,
      relationship.relationType,
    );

    return toRelationshipDetail(relationship, definition ?? undefined);
  }

  async listRelationshipsByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<RelationshipDetail[]> {
    // Flow 4 §Read Relation step 4: the entity itself is validated before its
    // relationships are listed, so an id from another project answers 404
    // rather than a plausible-looking empty list.
    const location = await this.contentEntityLocator.locate({
      entityType,
      entityId,
    });

    assertEntityInProject(location, projectId, "Content");

    const relationships =
      await this.contentRelationshipRepository.findByEntity(
        projectId,
        entityType,
        entityId,
      );

    // One query for the whole vocabulary rather than one per row: a list of 50
    // relationships would otherwise be 51 round trips, and every row needs its
    // inverse label.
    const definitions =
      await this.relationshipDefinitionReader.findAllByProject(projectId);

    return relationships.map((relationship) =>
      toRelationshipDetail(
        relationship,
        definitions.get(relationship.relationType),
      ),
    );
  }

  async updateRelationshipNote(
    projectId: string,
    relationshipId: string,
    input: UpdateRelationshipNoteInput,
  ): Promise<RelationshipDetail> {
    assertCanWrite(input.requestingMembership);

    const relationship = await this.loadExistingRelationship(
      projectId,
      relationshipId,
    );

    // Loaded for the response label only — the note update touches neither the
    // predicate nor the endpoints, so nothing here can be invalidated by it.
    const definition = await this.relationshipDefinitionReader.findByPredicate(
      projectId,
      relationship.relationType,
    );

    let changed: boolean;
    try {
      changed = relationship.updateNote({
        note: input.note,
        now: this.clock.now(),
      });
    } catch (error) {
      mapRelationshipError(error);
    }

    // A PATCH that changes nothing must not burn a version increment — same
    // no-op contract as Scene/Character updates, and here it also keeps a
    // pointless write from colliding with a concurrent one.
    if (!changed) {
      return toRelationshipDetail(relationship, definition ?? undefined);
    }

    try {
      // The aggregate still carries the version it was read at; the adapter
      // uses it as the guard and the mapper does the increment.
      await this.contentRelationshipRepository.update(relationship);
    } catch (error) {
      mapRelationshipError(error);
    }

    return toRelationshipDetail(relationship, definition ?? undefined);
  }

  // DELETE IS A RETRACTION SINCE STEP 4b-2, and the row it destroys is only the
  // PROJECTION. The fact itself stays in the log with a `retract` row pointing at
  // it, so "who claimed this and when was it withdrawn" is answerable afterwards
  // — which it was not while the delete was the whole of the operation.
  //
  // `retract` and not `terminate`, which is the decision this method turns on
  // (premis §8.3): retraction is transaction-time — the claim is treated as never
  // having been made, at every cut — and that is what this endpoint already
  // meant. Termination is valid-time and needs a story anchor the endpoint has no
  // way to supply; giving it a NULL anchor would store a cessation whose "when"
  // no reader can answer. Premis §8.3 asks the UI to offer the two as separate
  // actions, so the terminate half waits for an action that can name a moment.
  //
  // ONE THING IT REFUSES SINCE 2026-08-19 (gerbang G1, T-2): a relationship whose
  // origin assertion has a parent transition answers 409, not 200. The full argument
  // sits at the guard inside the transaction; the short version is that `retract`
  // claims a fact was never true, and a narrated fact was.
  //
  // The API contract does NOT change: still 200 with a null payload
  // (`RelationshipController.deleteRelationship` → `success(c, null, 200)`), and a
  // subsequent GET still answers 404, because the projection is what the
  // relationship API reads. Said "204" until 2026-08-19 (gerbang G1, T-7) — a
  // comment that claims an API contract has to be right.
  async deleteRelationship(
    projectId: string,
    relationshipId: string,
    input: DeleteRelationshipInput,
  ): Promise<void> {
    assertCanWrite(input.requestingMembership);

    // This read is not just a 404 check: it is where `expectedVersion` comes
    // from (Flow 4 §Delete step 4). What the guard protects is the interleaving
    // between this read and the delete below, inside this one request — not
    // client staleness, which is why nothing about the version is asked of the
    // caller.
    //
    // It is also where the origin assertion comes from. The projection row
    // carries the pointer, so the retraction names an ID rather than a fact
    // pattern — which is what makes it idempotent under a double click and what
    // keeps it from withdrawing a DIFFERENT author's assertion of the same fact
    // (premis §8.3 explicitly allows two such assertions to coexist).
    const relationship = await this.loadExistingRelationship(
      projectId,
      relationshipId,
    );

    // Guaranteed present by the composite foreign key `(project_id,
    // relation_type)` with `onDelete: Restrict` — the predicate cannot be deleted
    // while this row references it. Checked anyway because the retraction needs
    // the definition's ID for provenance: this row has no parent transition, so
    // naming the predicate is the only way it can satisfy `has_provenance`, and a
    // non-null assertion here would be an unfalsifiable line.
    const definition = await this.relationshipDefinitionReader.findByPredicate(
      projectId,
      relationship.relationType,
    );

    if (definition === null) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unknown relation type: ${relationship.relationType}`,
      );
    }

    try {
      await this.relationshipUnitOfWork.transaction(
        async (repositories, outboxEvents) => {
          // Read INSIDE the transaction, and unnarrowed: the retraction must
          // carry the target's real `effect_type` (C-1 — a kind that can lie is
          // the bug that shape closes), and `findById` cannot see a parentless
          // assertion by design.
          const assertion = await repositories.assertions.findAssertionById(
            projectId,
            relationship.sourceAssertionId,
          );

          // Unreachable through the foreign key, which refuses a projection row
          // whose origin is absent. Kept because the alternative is a non-null
          // assertion, and a row that somehow drifted deserves an error that
          // says which invariant broke.
          if (assertion === null) {
            throw new Error(
              `Relationship ${relationship.id} points at assertion ${relationship.sourceAssertionId}, which does not exist in project ${projectId}`,
            );
          }

          // DECIDED 2026-08-19 — blokir gerbang G1 (T-2 + A-3). A relationship whose
          // fact was asserted BY A NARRATIVE TRANSITION cannot be withdrawn through
          // this endpoint. Three reasons, and the first is the one that decides it:
          //
          // 1. `retract` means "this claim was never true, at every cut" (premis
          //    §8.3). A narrated fact WAS true in the story — the author wrote the
          //    scene where it began. Retracting it does not correct a mistake, it
          //    erases the story's own causality, and it leaves the log stating two
          //    things that cannot both hold: the transition still reports `applied`,
          //    while the fact it applied is gone at every cut.
          // 2. The honest operation for "it stopped holding" is `terminate`, which is
          //    valid-time and needs a story anchor. This endpoint has no way to name
          //    a story moment, which is exactly why 4b-2 chose `retract` for it.
          //    Allowing it here would answer §8.3's open sub-item
          //    (`reversesTransitionId` → retract? terminate?) in the most destructive
          //    direction, using the least information available anywhere.
          // 3. `05-implementation-policy/05_append_only_invariants.md` §NarrativeTransition
          //    — Aturan Delete already has the answer for undoing an applied effect:
          //    a reversal transition. That rule survived the 2026-08-19 revision of
          //    that document precisely because it is still the right shape.
          //
          // THE OTHER DIRECTION IS ALLOWED, and the asymmetry is the point (A-3): a
          // narrative `relationship_remove` may end a fact this endpoint asserted,
          // because it carries strictly MORE information — a story anchor through its
          // parent transition — and it adds a log row instead of erasing one. What is
          // still missing there is that row itself (`terminate` naming the origin
          // assertion); it belongs to 4b-3, and until then the window is stated in
          // `narrative-transition.end2end.test.ts` and in `notes/phase-11-validation.md`.
          //
          // 409 and not 403: the caller has the right, the STATE refuses. And the
          // message names the way out, because an error that only says "no" turns a
          // deliberate rule into a bug report.
          if (assertion.narrativeTransitionId !== null) {
            throw new AppError(
              ErrorCode.CONFLICT,
              "This relationship was asserted by a narrative transition and cannot be deleted directly. Reverse the transition, or narrate the relationship ending with a relationship_remove effect.",
              {
                narrativeTransitionId: assertion.narrativeTransitionId,
                sourceAssertionId: assertion.id,
              },
            );
          }

          let retraction: TransitionEffect;
          try {
            retraction = TransitionEffect.retractFact({
              id: this.idGenerator.generate(),
              projectId,
              target: assertion,
              definition,
              now: this.clock.now(),
            });
          } catch (error) {
            mapRelationshipError(error);
          }

          await repositories.assertions.insert(retraction);

          // The FOLD, undone. Removing the projection row rather than flagging it
          // is what keeps read-your-writes intact for the CRUD surface: a
          // retracted claim was never true, so the row that projected it must not
          // survive the transaction that withdrew it. The version guard stays —
          // §8.3 dissolves the motive for a version on the LOG operation, which
          // names an id, but this statement is still a read-then-write on the
          // projection inside one request.
          await repositories.contentRelationships.delete(
            relationship.id,
            relationship.version,
          );

          // Same precedent as `content.relationship.asserted`: written now,
          // consumed by `GraphProjector` at 11.4. A projector that saw the
          // assertion appear and never saw it withdrawn would rebuild the fact
          // back into `evaluation_edges`.
          //
          // Three words like the assertion key, so the same binding caveat applies
          // (gerbang G1, T-1 + A-2) — and THIS is the key whose loss would be
          // silent in the worst way: a projector bound to the assertion event but
          // not to this one resurrects facts the author retracted.
          await outboxEvents.insert({
            id: this.idGenerator.generate(),
            eventType: CONTENT_RELATIONSHIP_RETRACTED,
            eventVersion: 1,
            aggregateType: "content_relationship",
            aggregateId: relationship.id,
            projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId,
              retractionId: retraction.id,
              assertionId: assertion.id,
              relationshipId: relationship.id,
              predicate: relationship.relationType,
            },
            routingKey: CONTENT_RELATIONSHIP_RETRACTED,
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapRelationshipError(error);
    }
  }

  // `findById` is not project-scoped (see the port's comment), so ownership is
  // compared HERE and a row from another project answers 404, never 403 — the
  // API must not confirm that another tenant's relationship exists. Identical
  // shape to CharacterService.loadExistingCharacter.
  private async loadExistingRelationship(
    projectId: string,
    relationshipId: string,
  ): Promise<ContentRelationship> {
    const relationship =
      await this.contentRelationshipRepository.findById(relationshipId);

    if (relationship?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Relationship not found");
    }

    return relationship;
  }
}

// Free function rather than a private method: it reads no service state, and
// 7.3's RelationshipDtoMapper will need the same shape when it adds `direction`
// and the effective label for a given perspective.
function toRelationshipDetail(
  relationship: ContentRelationship,
  definition: RelationshipDefinition | undefined,
): RelationshipDetail {
  return {
    id: relationship.id,
    projectId: relationship.projectId,
    sourceEntityType: relationship.sourceEntityType,
    sourceEntityId: relationship.sourceEntityId,
    targetEntityType: relationship.targetEntityType,
    targetEntityId: relationship.targetEntityId,
    relationType: relationship.relationType,
    directionality: definition?.directionality,
    inverseLabel: definition?.inverseLabel,
    note: relationship.note,
    createdByUserId: relationship.createdByUserId,
    createdAt: relationship.createdAt,
    updatedAt: relationship.updatedAt,
  };
}

export function createRelationshipService({
  clock,
  idGenerator,
  contentRelationshipRepository,
  contentEntityLocator,
  relationshipDefinitionReader,
  relationshipUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  contentRelationshipRepository: ContentRelationshipRepository;
  contentEntityLocator: ContentEntityLocator;
  relationshipDefinitionReader: RelationshipDefinitionReader;
  relationshipUnitOfWork: RelationshipUnitOfWork;
}): RelationshipService {
  return new RelationshipService(
    clock,
    idGenerator,
    contentRelationshipRepository,
    contentEntityLocator,
    relationshipDefinitionReader,
    relationshipUnitOfWork,
  );
}
