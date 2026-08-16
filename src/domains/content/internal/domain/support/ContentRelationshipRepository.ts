import type { ContentRelationship } from "./ContentRelationship.js";
import type { ContentEntityType } from "./ContentRevision.js";

export type ContentRelationshipRepository = {
  // Not scoped by project, exactly like `SceneRepository.findById`: the row is
  // returned and RelationshipService compares `projectId` itself. A relationship
  // belonging to another project must answer 404, never 403 — the API must not
  // confirm that another tenant's row exists (Flow 4 §Update/§Delete error
  // paths). List reads below are scoped inside the repository instead, because
  // there the wrong tenant has to receive an empty list rather than a comparison
  // the caller could forget to make.
  findById(id: string): Promise<ContentRelationship | null>;

  // One call returns BOTH directions: the entity can sit on either side of the
  // row, and Flow 4 §Read Relation ("Read: kedua sisi") is explicit that a
  // faction reads the characters pointing at it as well as the ones it points
  // at. `direction` and the effective label are computed per-row by
  // RelationshipDtoMapper from the perspective of THIS entity — they are never
  // stored, and the registry only supplies the `inverseLabel` symbol
  // (registry §7.5).
  //
  // `projectId` is required even though `(entityType, entityId)` already selects
  // the right rows — tenant scoping is enforced HERE, for the same reason
  // `SceneRepository.findByChapterId` takes it (`../story/SceneRepository.ts:11-19`)
  // and `ContentRevisionRepository.findByEntity` before that: without it, an id
  // from another tenant returns that tenant's relationships in bulk. Both
  // `(project_id, source_*)` and `(project_id, target_*)` are indexed
  // (`content-support.prisma:76-77`), so scoping is free.
  //
  // Ordering is part of the contract, not the adapter's choice: `createdAt` asc
  // with `id` asc as tie-break, so list output is stable across calls and
  // reproducible in tests. No relation-type filter and no pagination yet — left
  // open deliberately until a real need appears (notes §5).
  //
  // SECOND CONSUMER, and the reason this returns rows rather than a count:
  // `03-database-design/06_content_tables.md:302` + §Delete Behavior (310-311)
  // and Flow 3 §Delete refuse a content delete while a "generic content
  // relationship" still exists — and they demand the BLOCKING LIST, not a
  // number, in three places (`03_flow_03_content_crud.md:131` "REJECT dengan
  // detail relasi yang menghalangi", `:142` 409 "Response berisi daftar relasi
  // yang menghalangi", `:167` Keputusan Desain). A `countByEntity()` was
  // considered and dropped at the 7.1 gate: on the happy path an empty result
  // set costs the same index scan as COUNT, and on the blocked path the caller
  // has to load these rows anyway, so the count only ever added a second
  // round-trip plus a second definition of the same question to drift from
  // (this repository would also have been the codebase's first `count*` method).
  //
  // The rule cannot be enforced by the database: this table points at entities
  // polymorphically, with no FK, so the P2003 / `...ReferencedError` machinery of
  // Phase 4-6 can never see it. Three things whoever wires the guard has to know
  // (item 7.4b, notes §9):
  //
  // 1. Only 2 of the 9 delete flows record the gap in code
  //    (`../../application/story/CharacterService.ts:355`,
  //    `../../application/world/WorldElementService.ts:366`, both waiting on
  //    "ContentRelationship has no domain/repository yet" — this file). The other
  //    seven say nothing, so all nine have to be swept; the comments are not a
  //    trail to follow.
  // 2. The read belongs INSIDE the delete transaction (Flow 3 step 6 puts
  //    revision + outbox + delete in one). Repositories here are built per
  //    client, so this has to reach the guard through the transaction's client —
  //    `ContentRepositories` was extended for exactly that in 7.4b. Being inside
  //    buys one consistent snapshot, avoids taking a second pool connection
  //    while the first is held, and is where a pessimistic lock would go if it
  //    is ever added — it does NOT make the guard atomic with the delete (see
  //    point 3, and `../../application/ports/ContentUnitOfWork.ts`).
  // 3. Even then it is best-effort: with no FK, "empty then delete" can still
  //    interleave with a concurrent relationship insert, because
  //    relationship-create reads the entity while entity-delete reads the
  //    relationships — the two take their locks in opposite order. Closing that
  //    needs a pessimistic lock
  //    (`05-implementation-policy/06_concurrency_control_policy.md` reserves
  //    those for rare, critical operations). Decide it explicitly; do not assume
  //    the guard is airtight.
  //
  // Still open, and cheaper to settle after 7.2 exists: these rows carry
  // `(entityType, entityId)`, never names, so they satisfy "daftar relasi yang
  // menghalangi" at id level but not the doc's illustrative wording "terhubung ke
  // Faction X, Event Y". Producing names needs a lookup across all nine entity
  // types — the shape of `createContentEntityDescriptors()` (notes K3).
  findByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRelationship[]>;

  // Throws ContentRelationshipRepositoryDuplicateError when the 6-column unique
  // index rejects the row (P2002). That is the whole duplicate check: the
  // service must NOT look for an existing relationship first — canonicalization
  // in the domain plus this constraint cover it without a read-before-write
  // window (Flow 4 step 8, superseded 2026-08-14).
  insert(contentRelationship: ContentRelationship): Promise<void>;

  // Only `note` is writable (Flow 4 §Update Relation addendum): the aggregate
  // itself carries the version it was read at, so the adapter guards on
  // `where: { id, version }` and increments in the mapper — Phase 6 precedent
  // `PrismaSceneRepository.update()` + `SceneMapper.toUpdatePersistence()`.
  // `count === 0` must be split: NotFound when the row is gone, Conflict when it
  // is still there with a different version (409 vs 404, Flow 4 error path).
  update(contentRelationship: ContentRelationship): Promise<void>;

  // Guarded delete — `delete(id, expectedVersion)`, never `delete(id)`.
  // `06_concurrency_control_policy.md:198-218` (FROZEN) decided `version` AND
  // the delete-guard together for this table: it has no `content_revisions`
  // history, so a silent overwrite is permanent, and an unguarded delete would
  // be a bypass that voids the version guarantee for the whole row.
  //
  // `expectedVersion` never crosses the wire — no body field, no `If-Match`.
  // The service reads the aggregate (Flow 4 §Delete step 4) and passes the
  // version it just read, so what is protected is the interleaving between read
  // and write inside one request, not client staleness. Same 0-row split as
  // update(): NotFound vs Conflict.
  delete(id: string, expectedVersion: number): Promise<void>;
};
