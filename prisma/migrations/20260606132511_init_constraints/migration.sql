-- Baseline custom SQL for migration 3: init_constraints.
-- Copy this file into the migration.sql created after init_schema.
--
-- This file intentionally contains only:
-- - CHECK constraints
-- - partial unique indexes
--
-- Descending indexes are declared in feedback.prisma with sort: Desc.

-- Project domain
ALTER TABLE project_invitations
ADD CONSTRAINT project_invitations_offered_role_not_writer
CHECK (offered_role <> 'writer');

-- Content world domain
ALTER TABLE layers
ADD CONSTRAINT layers_level_positive CHECK (level > 0);

ALTER TABLE layers
ADD CONSTRAINT layers_no_self_parent CHECK (parent_id <> id);

ALTER TABLE maps
ADD CONSTRAINT maps_no_self_parent CHECK (parent_id <> id);

-- Content support domain
ALTER TABLE content_relationships
ADD CONSTRAINT content_relationships_no_self_reference
CHECK (
  NOT (
    source_entity_type = target_entity_type
    AND source_entity_id = target_entity_id
  )
);

ALTER TABLE content_revisions
ADD CONSTRAINT content_revisions_snapshot_presence
CHECK (
  (change_type = 'create' AND before_snapshot IS NULL AND after_snapshot IS NOT NULL)
  OR
  (change_type = 'update' AND before_snapshot IS NOT NULL AND after_snapshot IS NOT NULL)
  OR
  (change_type = 'delete' AND before_snapshot IS NOT NULL AND after_snapshot IS NULL)
);

-- AI domain
ALTER TABLE validation_requests
ADD CONSTRAINT validation_requests_scope_target_consistency
CHECK (
  (scope_type = 'entity' AND target_entity_type IS NOT NULL AND target_entity_id IS NOT NULL)
  OR
  (scope_type = 'project' AND target_entity_type IS NULL AND target_entity_id IS NULL)
);

ALTER TABLE validation_requests
ADD CONSTRAINT validation_requests_attempt_bounds
CHECK (attempt_count >= 0 AND max_attempts > 0);

ALTER TABLE ai_usage_logs
ADD CONSTRAINT ai_usage_logs_tokens_non_negative
CHECK (
  (input_tokens IS NULL OR input_tokens >= 0)
  AND (output_tokens IS NULL OR output_tokens >= 0)
  AND (total_tokens IS NULL OR total_tokens >= 0)
);

ALTER TABLE ai_usage_logs
ADD CONSTRAINT ai_usage_logs_cost_non_negative
CHECK (cost_amount IS NULL OR cost_amount >= 0);

ALTER TABLE ai_usage_logs
ADD CONSTRAINT ai_usage_logs_completed_after_started
CHECK (completed_at IS NULL OR completed_at >= started_at);

ALTER TABLE chat_messages
ADD CONSTRAINT chat_messages_metrics_non_negative
CHECK (
  (input_tokens IS NULL OR input_tokens >= 0)
  AND (output_tokens IS NULL OR output_tokens >= 0)
  AND (total_tokens IS NULL OR total_tokens >= 0)
  AND (latency_ms IS NULL OR latency_ms >= 0)
);

-- Feedback domain
ALTER TABLE validation_results
ADD CONSTRAINT validation_results_source_consistency
CHECK (
  (
    source = 'ai'
    AND validation_request_id IS NOT NULL
    AND created_by_user_id IS NULL
  )
  OR
  (
    source = 'manual'
    AND validation_request_id IS NULL
    AND created_by_user_id IS NOT NULL
  )
);

-- Infra domain
ALTER TABLE outbox_events
ADD CONSTRAINT outbox_events_retry_count_non_negative
CHECK (retry_count >= 0);

ALTER TABLE outbox_events
ADD CONSTRAINT outbox_events_max_retries_non_negative
CHECK (max_retries >= 0);

ALTER TABLE outbox_events
ADD CONSTRAINT outbox_events_published_at_only_when_published
CHECK (
  (status = 'published' AND published_at IS NOT NULL)
  OR
  (status <> 'published' AND published_at IS NULL)
);

ALTER TABLE dead_letter_events
ADD CONSTRAINT dead_letter_events_retry_count_non_negative
CHECK (retry_count >= 0);

ALTER TABLE dead_letter_events
ADD CONSTRAINT dead_letter_events_max_retries_non_negative
CHECK (max_retries >= 0);

ALTER TABLE dead_letter_events
ADD CONSTRAINT dead_letter_events_replay_attempt_count_non_negative
CHECK (replay_attempt_count >= 0);

ALTER TABLE dead_letter_events
ADD CONSTRAINT dead_letter_events_max_replay_attempts_non_negative
CHECK (max_replay_attempts >= 0);

ALTER TABLE dead_letter_events
ADD CONSTRAINT dead_letter_events_replayed_at_only_when_replayed
CHECK (
  (status = 'replayed' AND replayed_at IS NOT NULL)
  OR
  (status <> 'replayed' AND replayed_at IS NULL)
);

ALTER TABLE dead_letter_events
ADD CONSTRAINT dead_letter_events_ignored_at_only_when_ignored
CHECK (
  (status = 'ignored' AND ignored_at IS NOT NULL)
  OR
  (status <> 'ignored' AND ignored_at IS NULL)
);

ALTER TABLE dead_letter_events
ADD CONSTRAINT dead_letter_events_replayed_outbox_only_when_replayed
CHECK (
  (status = 'replayed' AND replayed_as_outbox_event_id IS NOT NULL)
  OR
  (status <> 'replayed' AND replayed_as_outbox_event_id IS NULL)
);

-- Partial unique indexes
CREATE UNIQUE INDEX user_projects_unique_active_member
ON user_projects(project_id, user_id)
WHERE status = 'active';

CREATE UNIQUE INDEX user_projects_unique_active_writer
ON user_projects(project_id)
WHERE role = 'writer' AND status = 'active';

CREATE UNIQUE INDEX project_invitations_unique_pending_email
ON project_invitations(project_id, email)
WHERE status = 'pending';

CREATE UNIQUE INDEX project_ownership_transfers_unique_pending_project
ON project_ownership_transfers(project_id)
WHERE status = 'pending';

CREATE UNIQUE INDEX validation_requests_unique_active_entity
ON validation_requests(project_id, scope_type, target_entity_type, target_entity_id)
WHERE status IN ('pending', 'processing', 'result_published');

CREATE UNIQUE INDEX validation_requests_unique_active_project
ON validation_requests(project_id, scope_type)
WHERE scope_type = 'project'
  AND status IN ('pending', 'processing', 'result_published');

CREATE UNIQUE INDEX validation_result_targets_unique_primary
ON validation_result_targets(validation_result_id)
WHERE role = 'primary';
