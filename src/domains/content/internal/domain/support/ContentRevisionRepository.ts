import type { ContentEntityType, ContentRevision } from "./ContentRevision.js";

export type ContentRevisionRepository = {
  // No caller in the Create/Update/Delete flow being built now (4.4) — that
  // flow only ever calls insert(). Kept anyway for two consumers already
  // documented in frozen hard-context, not speculative additions:
  // (1) the outbox worker's staleness-guard + AI-validation context read
  // (03-database-design/10_content_revisions_vector_indexing.md §Qdrant
  // Sync Strategy step 5, §Dampak ke AI Validation) needs the actual
  // revision row (summary/reason/snapshot), not just the entity's
  // currentRevisionId pointer; (2) a per-entity revision-history read is
  // the reason this append-only table exists at all — an audit log with no
  // way to read its own history back would be pointless. Both findById and
  // findByEntity are the minimal primitives those two consumers need; if
  // neither materializes by the time Phase 9-11 (AI validation) starts,
  // revisit and prune rather than let this comment go stale.
  findById(id: string): Promise<ContentRevision | null>;

  findByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRevision[]>;

  insert(contentRevision: ContentRevision): Promise<void>;
};
