import { AppError } from "../../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";

import type { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type { ContentEntityLocator } from "../ports/ContentEntityLocator.js";

// Item 7.4b — the M:N half of Flow 3 §Delete step 5, shared by all nine content
// deletes (`03-database-design/06_content_tables.md:302` + §Delete Behavior
// 310-311, FROZEN: a content entity may not be deleted while a "generic content
// relationship" still points at it).
//
// The rule exists only here. `content_relationships` names its endpoints
// polymorphically — `(entity_type, entity_id)` columns, no foreign key
// (`content-support.prisma:55-81`) — so the P2003 / `...ReferencedError`
// machinery every Phase 4-6 delete relies on is structurally blind to it. Nine
// near-identical guards would have been nine chances to word the 409
// differently; one module means the shape of that answer is decided once.
//
// Deliberately NOT airtight, and this is the accepted risk recorded for 7.4b:
// the read runs inside the delete transaction (see assertNoBlockingRelationships)
// but under READ COMMITTED a plain SELECT takes no lock at all, so a concurrent
// POST /relationships can still land between the check and the delete. Nothing
// serialises the two sides — not lock ORDERING, which would imply a deadlock
// risk that does not exist here: relationship-create reads the ENTITY (untouched
// by the delete so far) while entity-delete reads the RELATIONSHIPS (not yet
// written by the insert), so neither ever sees a row the other would conflict
// on. Same conclusion as a lock-order story, different mechanism. Closing
// it needs a pessimistic lock, which
// `05-implementation-policy/06_concurrency_control_policy.md` reserves for rare
// critical operations (Transfer Ownership, Narrative Transition apply) —
// content delete is not one. The worst outcome of the surviving race is an
// orphan relationship row: no data loss, no inverted authorization, and
// repairable, because the row is still readable and deletable through the
// relationship endpoints.

// How many blocking relationships the 409 spells out. The count is always
// reported in full and `truncated` says plainly when the list was cut, so this
// is a bounded answer rather than a silent one: a heavily-linked character can
// carry hundreds of `appears_in` rows, and naming each one means one aggregate
// load per DISTINCT counterpart entity. The complete list stays available at
// `GET /projects/:projectId/<segment>/:entityId/relationships`, which is the
// endpoint a client has to walk anyway to unlink them.
//
// Note what this cap does NOT bound: findByEntity() still materialises EVERY
// blocking row inside the open transaction. Deliberate — a `take: LIMIT + 1`
// would bound the read but reduce the answer to "20+", and telling a writer
// exactly how many links they have to sever is worth more than the rows saved.
// The magnitude this product actually produces (hundreds at worst, one narrow
// index scan) makes that trade cheap; revisit it only if the count itself stops
// being affordable, and change the payload contract when you do.
export const BLOCKING_RELATIONSHIP_DETAIL_LIMIT = 20;

export type BlockingRelationshipDetail = {
  // The relationship row's id — what a client passes to
  // `DELETE /relationships/:relationshipId` to clear the block.
  id: string;
  relationType: string;
  // The entity at the OTHER end. The entity being deleted is already named by
  // the request itself, so repeating it in every list item would be noise.
  entityType: ContentEntityType;
  entityId: string;
  // `null` means the name could not be resolved — the counterpart row is gone,
  // or belongs to another project (an orphan, exactly what the race above can
  // leave behind). Never a substitute for "the entity has no name": an untitled
  // scene resolves to "".
  entityName: string | null;
};

// Internal to the delete path: raised inside the transaction so the transaction
// rolls back, then converted to the 409 by mapBlockedByRelationshipsError()
// AFTER the rollback. It must never reach a controller — the nine service tests
// assert the 409, not this class.
//
// The two-step exists to keep name resolution OUT of the open transaction.
// `ContentEntityLocator` is built on the pooled client, not on `tx`, so
// resolving names inside the callback would ask the pool for a second
// connection while still holding the first — the classic way to turn a busy
// error path into pool starvation. Nothing has been written at guard time, so
// there is nothing to lose by rolling back first and naming afterwards.
export class ContentRelationshipsBlockedError extends Error {
  readonly projectId: string;
  readonly entityType: ContentEntityType;
  readonly entityId: string;
  readonly blocking: ContentRelationship[];

  constructor(parameters: {
    projectId: string;
    entityType: ContentEntityType;
    entityId: string;
    blocking: ContentRelationship[];
  }) {
    super("Content entity is still linked by content relationships");
    this.name = "ContentRelationshipsBlockedError";
    this.projectId = parameters.projectId;
    this.entityType = parameters.entityType;
    this.entityId = parameters.entityId;
    this.blocking = parameters.blocking;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Call this as the FIRST statement inside the delete transaction, before the
// revision insert and the outbox insert: it is a plain read, and everything it
// would precede is work that a block throws away anyway. `contentRelationships`
// must be the repository handed in by the unit of work — a repository built on
// the pooled client would be reading outside the transaction.
export async function assertNoBlockingRelationships(
  contentRelationships: ContentRelationshipRepository,
  entity: {
    projectId: string;
    entityType: ContentEntityType;
    entityId: string;
  },
): Promise<void> {
  const blocking = await contentRelationships.findByEntity(
    entity.projectId,
    entity.entityType,
    entity.entityId,
  );

  if (blocking.length === 0) {
    return;
  }

  throw new ContentRelationshipsBlockedError({
    projectId: entity.projectId,
    entityType: entity.entityType,
    entityId: entity.entityId,
    blocking,
  });
}

// Call this as the FIRST statement of the delete's catch block, before
// map<Entity>Error(): it returns untouched for every other error, so the
// existing repository/domain mapping still runs. It cannot be folded INTO
// map<Entity>Error() — resolving names is asynchronous and those mappers are
// synchronous `never`-returning functions.
export async function mapBlockedByRelationshipsError(
  error: unknown,
  context: {
    contentEntityLocator: ContentEntityLocator;
    // Capitalised singular used in the message: "Character", "World map".
    entityLabel: string;
  },
): Promise<void> {
  if (!(error instanceof ContentRelationshipsBlockedError)) {
    return;
  }

  // Paired up front rather than as two arrays walked by index: the counterpart
  // is derived data that must stay welded to the row it came from.
  const reported = error.blocking
    .slice(0, BLOCKING_RELATIONSHIP_DETAIL_LIMIT)
    .map((relationship) => ({
      relationship,
      counterpart: counterpartOf(relationship, error.entityType, error.entityId),
    }));

  const names = await resolveEntityNames(
    reported.map((entry) => entry.counterpart),
    error.projectId,
    context.contentEntityLocator,
  );

  const blockingRelationships: BlockingRelationshipDetail[] = reported.map(
    ({ relationship, counterpart }) => ({
      id: relationship.id,
      relationType: relationship.relationType,
      entityType: counterpart.entityType,
      entityId: counterpart.entityId,
      entityName: names.get(keyOf(counterpart)) ?? null,
    }),
  );

  const total = error.blocking.length;

  throw new AppError(
    ErrorCode.CONFLICT,
    `${context.entityLabel} is still linked to ${total} content relationship${total === 1 ? "" : "s"} and cannot be deleted`,
    {
      blockingRelationshipCount: total,
      truncated: total > blockingRelationships.length,
      blockingRelationships,
    },
  );
}

type ContentEntityReference = {
  entityType: ContentEntityType;
  entityId: string;
};

function keyOf(entity: ContentEntityReference): string {
  return `${entity.entityType}:${entity.entityId}`;
}

// Which end of the row is the OTHER one. Same test RelationshipDtoMapper's
// viewFromPerspective() makes, and it is exhaustive for the same reason:
// findByEntity() only returns rows where this entity is one of the two
// endpoints, and registry rule 9 forbids a self-relationship, so exactly one
// side matches.
function counterpartOf(
  relationship: ContentRelationship,
  entityType: ContentEntityType,
  entityId: string,
): ContentEntityReference {
  const isSource =
    relationship.sourceEntityType === entityType &&
    relationship.sourceEntityId === entityId;

  return isSource
    ? {
      entityType: relationship.targetEntityType,
      entityId: relationship.targetEntityId,
    }
    : {
      entityType: relationship.sourceEntityType,
      entityId: relationship.sourceEntityId,
    };
}

// Deduplicated before the lookups: two relationships of different types between
// the same pair (a character both `member_of` and `founder_of` one faction) are
// two blocking rows but one entity to name.
async function resolveEntityNames(
  counterparts: ContentEntityReference[],
  projectId: string,
  contentEntityLocator: ContentEntityLocator,
): Promise<Map<string, string | null>> {
  const distinct = new Map<string, ContentEntityReference>();

  for (const counterpart of counterparts) {
    distinct.set(keyOf(counterpart), counterpart);
  }

  const located = await Promise.all(
    [...distinct.values()].map(async (counterpart) => {
      const location = await contentEntityLocator.locate(counterpart);

      // A counterpart in another project is treated exactly like a missing one.
      // It cannot happen through the relationship API (registry rule 6 rejects
      // cross-project endpoints at create time), so reaching this branch means
      // an orphan or a corrupted row — and answering it with the other tenant's
      // entity name would leak across projects to confirm it.
      if (location?.projectId !== projectId) {
        return [keyOf(counterpart), null] as const;
      }

      return [keyOf(counterpart), location.entityName] as const;
    }),
  );

  return new Map(located);
}
