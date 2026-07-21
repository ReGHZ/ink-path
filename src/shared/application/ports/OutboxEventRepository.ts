// Cross-domain port (03-database-design/12_outbox_event_persistence.md) —
// `outbox_events` is one shared table, not owned by any single domain
// (Content, AI, and Feedback all use the same mechanism), so this lives
// alongside Clock/IdGenerator in shared/ rather than under a domain's
// internal/domain/ folder. Producer-side only: the fields below are exactly
// what a domain transaction writes when it creates a pending event — the
// dispatcher-owned fields (status, retryCount, lockedAt, publishedAt, ...)
// are not part of this contract, they default in the DB and are mutated only
// by the outbox dispatcher worker, never by a domain write.
export type OutboxEvent = {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  projectId: string | null;
  triggeredByUserId: string | null;
  payload: Record<string, unknown>;
  routingKey: string;
  exchange: string;
};

export type OutboxEventRepository = {
  insert(event: OutboxEvent): Promise<void>;
};
