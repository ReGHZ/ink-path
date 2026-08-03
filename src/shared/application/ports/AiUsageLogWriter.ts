// 03-database-design/11_ai_usage_cost_tracking_table.md — every embedding provider call
// gets logged as one `ai_usage_logs` row, written in TWO steps (not a single write at the
// end): insert with `status = in_progress` when the provider call starts (doc §"Embedding
// Flow" / §"Generation Flow", both describe this same two-phase pattern), then update to
// its final status once the call completes. `begin()` returns the row id so the caller can
// pair it with the matching `complete()` — no domain repository exists yet for this table
// (the AI domain itself is a later phase), so this is a narrow write-only port scoped to
// exactly what the embedding worker needs, same reasoning as EmbeddingProvider/VectorIndex.
export type BeginAiUsageLogInput = {
  projectId: string;
  triggeredByUserId: string;
  provider: string;
  model: string;
  contentRevisionId: string;
  contextEntityType: string;
  contextEntityId: string;
  startedAt: Date;
};

export type CompleteAiUsageLogInput =
  | { status: "success"; completedAt: Date; latencyMs: number }
  | {
      status: "failed";
      completedAt: Date;
      latencyMs: number;
      errorMessage: string;
    };

export type AiUsageLogWriter = {
  begin(input: BeginAiUsageLogInput): Promise<string>;
  complete(id: string, input: CompleteAiUsageLogInput): Promise<void>;
};
