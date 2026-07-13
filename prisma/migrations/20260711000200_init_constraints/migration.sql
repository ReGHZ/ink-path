-- Migration 3/3: Custom SQL hardening — CHECK constraints, partial unique indexes,
-- partial indexes. Dijalankan setelah init_schema.
--
-- Sumber (frozen):
--   - 06-migration-planning/01_migration_plan.md §4
--   - 04-prisma-design/02_project.md, 03_content-world.md, 05_content-support.md, 06_ai.md, 07_feedback.md, 08_infra.md
--   - 04-prisma-design/09_validation.md (4 partial index Validation)
--   - 04-prisma-design/10_narrative_transition.md (2 partial index Narrative Transition)
--   - 2 partial unique rule_dependency_index (Option B — surrogate id + attributeName nullable)
--
-- Catatan: Prisma tidak track CHECK/partial index → tidak ada drift detection untuk yang di
-- sini. ALTER TABLE ADD CONSTRAINT tidak support IF NOT EXISTS, tapi Prisma
-- migration dijalankan sekali per _prisma_migrations entry → bukan risiko operasional normal.
-- DDL PostgreSQL bersifat transactional: kalau gagal di tengah, seluruh migration rollback.

-- =============================================================================
-- Kategori A: CHECK constraints
-- =============================================================================

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

-- =============================================================================
-- Kategori B: Partial unique indexes
-- =============================================================================

-- Project domain
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

-- Validation domain (sumber: 04-prisma-design/09_validation.md)
CREATE UNIQUE INDEX issue_targets_unique_primary_per_issue
ON issue_targets(issue_id)
WHERE role = 'primary';

-- Validation — rule_dependency_index (Option B: attributeName nullable, uniqueness di-enforce
-- lewat 2 partial unique terpisah untuk kasus entity-level vs attribute-level).
CREATE UNIQUE INDEX rule_dependency_index_unique_attr
ON rule_dependency_index(rule_id, entity_type, attribute_name)
WHERE attribute_name IS NOT NULL;

CREATE UNIQUE INDEX rule_dependency_index_unique_entity
ON rule_dependency_index(rule_id, entity_type)
WHERE attribute_name IS NULL;

-- =============================================================================
-- Kategori C: Partial (non-unique) indexes
-- =============================================================================

-- Validation domain (sumber: 04-prisma-design/09_validation.md)
CREATE INDEX validation_requests_processing_lease
ON validation_requests(project_id, status, lease_expires_at)
WHERE status = 'processing';

CREATE INDEX findings_conflict_fingerprint
ON findings(project_id, fingerprint)
WHERE outcome = 'conflict';

CREATE INDEX rules_project_active
ON rules(project_id)
WHERE archived_at IS NULL;

-- Narrative Transition (sumber: 04-prisma-design/10_narrative_transition.md)
CREATE INDEX transition_effects_by_content_revision
ON transition_effects(content_revision_id)
WHERE content_revision_id IS NOT NULL;

CREATE INDEX transition_effects_pending_by_entity
ON transition_effects(project_id, target_entity_type, target_entity_id)
WHERE applied_at IS NULL;
