-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ChatSessionStatus" AS ENUM ('active', 'archived', 'deleted');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "AiUsagePurpose" AS ENUM ('validation', 'discussion', 'generation', 'embedding');

-- CreateEnum
CREATE TYPE "AiOperationType" AS ENUM ('chat_completion', 'streaming_completion', 'embedding');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('in_progress', 'success', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled', 'deleted');

-- CreateEnum
CREATE TYPE "RefreshTokenRevokedReason" AS ENUM ('logout', 'rotation_reuse_detected', 'manual_revoke');

-- CreateEnum
CREATE TYPE "CharacterStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "FactionStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "PlotStatus" AS ENUM ('draft', 'active', 'completed');

-- CreateEnum
CREATE TYPE "ChapterStatus" AS ENUM ('outline', 'draft', 'review', 'published');

-- CreateEnum
CREATE TYPE "SceneStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "ContentEntityType" AS ENUM ('layer', 'map', 'character', 'faction', 'world_element', 'event', 'plot', 'chapter', 'scene');

-- CreateEnum
CREATE TYPE "ContentRevisionChangeType" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "LayerStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "MapStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "WorldElementStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "CommentType" AS ENUM ('general', 'suggestion', 'issue', 'question');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('active', 'resolved', 'archived');

-- CreateEnum
CREATE TYPE "CommentTargetRole" AS ENUM ('primary');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('pending', 'processing', 'published', 'failed', 'dead_lettered');

-- CreateEnum
CREATE TYPE "DeadLetterEventStatus" AS ENUM ('open', 'replayed', 'ignored', 'replay_failed');

-- CreateEnum
CREATE TYPE "DeadLetterFailureSource" AS ENUM ('outbox_publish');

-- CreateEnum
CREATE TYPE "NarrativeTransitionSourceType" AS ENUM ('scene', 'event', 'chapter');

-- CreateEnum
CREATE TYPE "TransitionEffectType" AS ENUM ('attribute_change', 'relationship_add', 'relationship_remove');

-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('private', 'shared', 'public');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('writer', 'editor', 'reviewer');

-- CreateEnum
CREATE TYPE "ProjectAiAccess" AS ENUM ('none', 'limited', 'full');

-- CreateEnum
CREATE TYPE "UserProjectStatus" AS ENUM ('active', 'removed', 'left', 'disabled');

-- CreateEnum
CREATE TYPE "ProjectInvitationStatus" AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "OwnershipTransferStatus" AS ENUM ('pending', 'accepted', 'rejected', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM ('structural', 'semantic');

-- CreateEnum
CREATE TYPE "ValidationScope" AS ENUM ('entity', 'project');

-- CreateEnum
CREATE TYPE "ValidationTriggerSource" AS ENUM ('reactive', 'incremental', 'full_scan', 'manual');

-- CreateEnum
CREATE TYPE "ValidationRequestStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "FindingSource" AS ENUM ('rule_engine', 'ai');

-- CreateEnum
CREATE TYPE "FindingOutcome" AS ENUM ('conflict', 'valid', 'unsupported');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('error', 'warning', 'info');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('open', 'resolved', 'dismissed', 'stale');

-- CreateEnum
CREATE TYPE "IssueStaleReason" AS ENUM ('rule_changed', 'rule_archived');

-- CreateEnum
CREATE TYPE "IssueTargetRole" AS ENUM ('primary', 'secondary');

-- CreateEnum
CREATE TYPE "TemplateScope" AS ENUM ('platform', 'user', 'community');

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" TEXT,
    "status" "ChatSessionStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sender_user_id" UUID,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "message_order" INTEGER NOT NULL,
    "model_provider" TEXT,
    "model_name" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "latency_ms" INTEGER,
    "finish_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "triggered_by_user_id" UUID NOT NULL,
    "purpose" "AiUsagePurpose" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation_type" "AiOperationType" NOT NULL,
    "status" "AiUsageStatus" NOT NULL DEFAULT 'in_progress',
    "validation_request_id" UUID,
    "chat_message_id" UUID,
    "content_revision_id" UUID,
    "context_entity_type" "ContentEntityType",
    "context_entity_id" UUID,
    "request_idempotency_key" TEXT,
    "provider_request_id" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cost_amount" DECIMAL(12,6),
    "cost_currency" TEXT NOT NULL DEFAULT 'USD',
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "username" CITEXT,
    "password_hash" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "parent_token_id" UUID,
    "replaced_by_token_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" "RefreshTokenRevokedReason",
    "last_used_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archetype" TEXT,
    "background" TEXT,
    "personality" TEXT,
    "goal" TEXT,
    "description" TEXT,
    "content" TEXT,
    "status" "CharacterStatus" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "background" TEXT,
    "ideology" TEXT,
    "size" TEXT,
    "content" TEXT,
    "status" "FactionStatus" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plots" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "theme" TEXT,
    "conflict" TEXT,
    "resolution" TEXT,
    "content" TEXT,
    "status" "PlotStatus" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "summary" TEXT,
    "content" TEXT,
    "status" "ChapterStatus" NOT NULL DEFAULT 'outline',
    "published_at" TIMESTAMP(3),
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "content" TEXT,
    "order_in_chapter" INTEGER NOT NULL,
    "status" "SceneStatus" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_revisions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entity_type" "ContentEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "change_type" "ContentRevisionChangeType" NOT NULL,
    "summary" TEXT,
    "reason" TEXT,
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_relationships" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_entity_type" "ContentEntityType" NOT NULL,
    "source_entity_id" UUID NOT NULL,
    "target_entity_type" "ContentEntityType" NOT NULL,
    "target_entity_id" UUID NOT NULL,
    "relation_type" TEXT NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layers" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "exposure" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT,
    "status" "LayerStatus" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maps" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "scale" TEXT,
    "terrain" TEXT,
    "environment" TEXT,
    "description" TEXT,
    "content" TEXT,
    "status" "MapStatus" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_elements" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "content" TEXT,
    "status" "WorldElementStatus" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "era" TEXT,
    "timeline_order" INTEGER,
    "event_type" TEXT,
    "significance" TEXT,
    "description" TEXT,
    "content" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "type" "CommentType" NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'active',
    "parent_comment_id" UUID,
    "issue_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_targets" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" "CommentTargetRole" NOT NULL DEFAULT 'primary',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_target_layers" (
    "comment_target_id" UUID NOT NULL,
    "layer_id" UUID NOT NULL,

    CONSTRAINT "comment_target_layers_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "comment_target_maps" (
    "comment_target_id" UUID NOT NULL,
    "map_id" UUID NOT NULL,

    CONSTRAINT "comment_target_maps_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "comment_target_characters" (
    "comment_target_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,

    CONSTRAINT "comment_target_characters_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "comment_target_factions" (
    "comment_target_id" UUID NOT NULL,
    "faction_id" UUID NOT NULL,

    CONSTRAINT "comment_target_factions_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "comment_target_world_elements" (
    "comment_target_id" UUID NOT NULL,
    "world_element_id" UUID NOT NULL,

    CONSTRAINT "comment_target_world_elements_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "comment_target_events" (
    "comment_target_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,

    CONSTRAINT "comment_target_events_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "comment_target_plots" (
    "comment_target_id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,

    CONSTRAINT "comment_target_plots_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "comment_target_chapters" (
    "comment_target_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,

    CONSTRAINT "comment_target_chapters_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "comment_target_scenes" (
    "comment_target_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,

    CONSTRAINT "comment_target_scenes_pkey" PRIMARY KEY ("comment_target_id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "project_id" UUID,
    "triggered_by_user_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'pending',
    "routing_key" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 10,
    "next_retry_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_events" (
    "id" UUID NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "root_outbox_event_id" UUID NOT NULL,
    "replayed_from_dead_letter_id" UUID,
    "failure_source" "DeadLetterFailureSource" NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "project_id" UUID,
    "triggered_by_user_id" UUID,
    "exchange" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "retry_count" INTEGER NOT NULL,
    "max_retries" INTEGER NOT NULL,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "failed_at" TIMESTAMP(3) NOT NULL,
    "status" "DeadLetterEventStatus" NOT NULL DEFAULT 'open',
    "replay_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_replay_attempts" INTEGER NOT NULL DEFAULT 1,
    "replayed_as_outbox_event_id" UUID,
    "replayed_at" TIMESTAMP(3),
    "ignored_at" TIMESTAMP(3),
    "last_replay_error_code" TEXT,
    "last_replay_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dead_letter_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "narrative_transitions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_entity_type" "NarrativeTransitionSourceType" NOT NULL,
    "source_entity_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "declared_by_user_id" UUID NOT NULL,
    "reverses_transition_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "narrative_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transition_effects" (
    "id" UUID NOT NULL,
    "narrative_transition_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "effect_type" "TransitionEffectType" NOT NULL,
    "target_entity_type" "ContentEntityType" NOT NULL,
    "target_entity_id" UUID NOT NULL,
    "field_path" TEXT,
    "new_value" TEXT,
    "relationship_type" TEXT,
    "related_entity_type" "ContentEntityType",
    "related_entity_id" UUID,
    "applied_at" TIMESTAMP(3),
    "content_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transition_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "genre" TEXT,
    "tone" TEXT,
    "style" TEXT,
    "language" TEXT,
    "visibility" "ProjectVisibility" NOT NULL DEFAULT 'private',
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "full_scan_enabled" BOOLEAN NOT NULL DEFAULT false,
    "full_scan_interval_hours" INTEGER NOT NULL DEFAULT 24,
    "next_full_scan_at" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_projects" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "ai_access" "ProjectAiAccess" NOT NULL DEFAULT 'none',
    "status" "UserProjectStatus" NOT NULL DEFAULT 'active',
    "invited_by_user_id" UUID,
    "joined_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_invitations" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "invited_user_id" UUID,
    "invited_by_user_id" UUID NOT NULL,
    "offered_role" "ProjectRole" NOT NULL,
    "offered_can_delete" BOOLEAN NOT NULL DEFAULT false,
    "offered_ai_access" "ProjectAiAccess" NOT NULL DEFAULT 'none',
    "status" "ProjectInvitationStatus" NOT NULL DEFAULT 'pending',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_user_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_ownership_transfers" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "status" "OwnershipTransferStatus" NOT NULL DEFAULT 'pending',
    "requested_by_user_id" UUID NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "RuleCategory" NOT NULL,
    "ast" JSONB NOT NULL,
    "dependency_metadata" JSONB NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "template_id" UUID,
    "template_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_versions" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "ast_snapshot" JSONB NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "changed_by" UUID NOT NULL,

    CONSTRAINT "rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_dependency_index" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entity_type" "ContentEntityType" NOT NULL,
    "attribute_name" TEXT,

    CONSTRAINT "rule_dependency_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_requests" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "scope" "ValidationScope" NOT NULL,
    "entity_id" UUID,
    "entity_type" "ContentEntityType",
    "snapshot_payload" JSONB NOT NULL,
    "trigger_source" "ValidationTriggerSource" NOT NULL,
    "status" "ValidationRequestStatus" NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "pending_ai_jobs" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "validation_request_id" UUID NOT NULL,
    "rule_id" UUID,
    "issue_id" UUID,
    "source" "FindingSource" NOT NULL,
    "outcome" "FindingOutcome" NOT NULL,
    "severity" "IssueSeverity",
    "message" TEXT,
    "fingerprint" TEXT,
    "rule_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "rule_id" UUID,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" "FindingSource" NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'open',
    "stale_reason" "IssueStaleReason",
    "first_detected_at" TIMESTAMP(3) NOT NULL,
    "first_detected_rule_version" INTEGER,
    "last_detected_at" TIMESTAMP(3) NOT NULL,
    "last_detected_rule_version" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_targets" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entity_type" "ContentEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "role" "IssueTargetRole" NOT NULL,

    CONSTRAINT "issue_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_nodes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_type" "ContentEntityType" NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "timeline_position" INTEGER,
    "last_event_sequence" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_edges" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_node_id" UUID NOT NULL,
    "target_node_id" UUID NOT NULL,
    "relationship_type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "RuleCategory" NOT NULL,
    "pattern_name" TEXT NOT NULL,
    "ast_template" JSONB NOT NULL,
    "parameter_definitions" JSONB,
    "scope" "TemplateScope" NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_template_tags" (
    "template_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "rule_template_tags_pkey" PRIMARY KEY ("template_id","tag")
);

-- CreateTable
CREATE TABLE "template_versions" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "ast_template" JSONB NOT NULL,
    "parameter_definitions" JSONB,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "changed_by" UUID,

    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_sessions_project_id_status_updated_at_idx" ON "chat_sessions"("project_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "chat_sessions_project_id_created_by_user_id_status_updated__idx" ON "chat_sessions"("project_id", "created_by_user_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "chat_sessions_created_by_user_id_updated_at_idx" ON "chat_sessions"("created_by_user_id", "updated_at");

-- CreateIndex
CREATE INDEX "chat_messages_project_id_created_at_idx" ON "chat_messages"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_project_id_session_id_idx" ON "chat_messages"("project_id", "session_id");

-- CreateIndex
CREATE INDEX "chat_messages_sender_user_id_created_at_idx" ON "chat_messages"("sender_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_session_id_message_order_key" ON "chat_messages"("session_id", "message_order");

-- CreateIndex
CREATE INDEX "ai_usage_logs_project_id_created_at_idx" ON "ai_usage_logs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_triggered_by_user_id_created_at_idx" ON "ai_usage_logs"("triggered_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_purpose_created_at_idx" ON "ai_usage_logs"("purpose", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_provider_model_created_at_idx" ON "ai_usage_logs"("provider", "model", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_validation_request_id_idx" ON "ai_usage_logs"("validation_request_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_chat_message_id_idx" ON "ai_usage_logs"("chat_message_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_content_revision_id_idx" ON "ai_usage_logs"("content_revision_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_status_created_at_idx" ON "ai_usage_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_project_id_context_entity_type_context_entity_idx" ON "ai_usage_logs"("project_id", "context_entity_type", "context_entity_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_triggered_by_user_id_purpose_created_at_idx" ON "ai_usage_logs"("triggered_by_user_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_project_id_purpose_created_at_idx" ON "ai_usage_logs"("project_id", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_parent_token_id_key" ON "refresh_tokens"("parent_token_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_token_id_key" ON "refresh_tokens"("replaced_by_token_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "characters_project_id_idx" ON "characters"("project_id");

-- CreateIndex
CREATE INDEX "characters_created_by_user_id_idx" ON "characters"("created_by_user_id");

-- CreateIndex
CREATE INDEX "characters_project_id_status_idx" ON "characters"("project_id", "status");

-- CreateIndex
CREATE INDEX "characters_project_id_created_at_idx" ON "characters"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "characters_project_id_name_idx" ON "characters"("project_id", "name");

-- CreateIndex
CREATE INDEX "factions_project_id_idx" ON "factions"("project_id");

-- CreateIndex
CREATE INDEX "factions_created_by_user_id_idx" ON "factions"("created_by_user_id");

-- CreateIndex
CREATE INDEX "factions_project_id_status_idx" ON "factions"("project_id", "status");

-- CreateIndex
CREATE INDEX "factions_project_id_created_at_idx" ON "factions"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "factions_project_id_name_idx" ON "factions"("project_id", "name");

-- CreateIndex
CREATE INDEX "plots_project_id_idx" ON "plots"("project_id");

-- CreateIndex
CREATE INDEX "plots_created_by_user_id_idx" ON "plots"("created_by_user_id");

-- CreateIndex
CREATE INDEX "plots_project_id_status_idx" ON "plots"("project_id", "status");

-- CreateIndex
CREATE INDEX "plots_project_id_created_at_idx" ON "plots"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "plots_project_id_name_idx" ON "plots"("project_id", "name");

-- CreateIndex
CREATE INDEX "chapters_project_id_idx" ON "chapters"("project_id");

-- CreateIndex
CREATE INDEX "chapters_created_by_user_id_idx" ON "chapters"("created_by_user_id");

-- CreateIndex
CREATE INDEX "chapters_project_id_status_idx" ON "chapters"("project_id", "status");

-- CreateIndex
CREATE INDEX "chapters_project_id_created_at_idx" ON "chapters"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "chapters_project_id_title_idx" ON "chapters"("project_id", "title");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_project_id_order_key" ON "chapters"("project_id", "order");

-- CreateIndex
CREATE INDEX "scenes_project_id_idx" ON "scenes"("project_id");

-- CreateIndex
CREATE INDEX "scenes_created_by_user_id_idx" ON "scenes"("created_by_user_id");

-- CreateIndex
CREATE INDEX "scenes_project_id_status_idx" ON "scenes"("project_id", "status");

-- CreateIndex
CREATE INDEX "scenes_chapter_id_idx" ON "scenes"("chapter_id");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_chapter_id_order_in_chapter_key" ON "scenes"("chapter_id", "order_in_chapter");

-- CreateIndex
CREATE INDEX "content_revisions_project_id_idx" ON "content_revisions"("project_id");

-- CreateIndex
CREATE INDEX "content_revisions_project_id_entity_type_entity_id_idx" ON "content_revisions"("project_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_revisions_project_id_entity_type_entity_id_revision_key" ON "content_revisions"("project_id", "entity_type", "entity_id", "revision_number");

-- CreateIndex
CREATE INDEX "content_relationships_project_id_idx" ON "content_relationships"("project_id");

-- CreateIndex
CREATE INDEX "content_relationships_project_id_source_entity_type_source__idx" ON "content_relationships"("project_id", "source_entity_type", "source_entity_id");

-- CreateIndex
CREATE INDEX "content_relationships_project_id_target_entity_type_target__idx" ON "content_relationships"("project_id", "target_entity_type", "target_entity_id");

-- CreateIndex
CREATE INDEX "content_relationships_project_id_relation_type_idx" ON "content_relationships"("project_id", "relation_type");

-- CreateIndex
CREATE INDEX "content_relationships_created_by_user_id_idx" ON "content_relationships"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_relationships_project_id_relation_type_source_entit_key" ON "content_relationships"("project_id", "relation_type", "source_entity_type", "source_entity_id", "target_entity_type", "target_entity_id");

-- CreateIndex
CREATE INDEX "layers_project_id_idx" ON "layers"("project_id");

-- CreateIndex
CREATE INDEX "layers_created_by_user_id_idx" ON "layers"("created_by_user_id");

-- CreateIndex
CREATE INDEX "layers_project_id_status_idx" ON "layers"("project_id", "status");

-- CreateIndex
CREATE INDEX "layers_project_id_created_at_idx" ON "layers"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "layers_project_id_name_idx" ON "layers"("project_id", "name");

-- CreateIndex
CREATE INDEX "layers_project_id_parent_id_idx" ON "layers"("project_id", "parent_id");

-- CreateIndex
CREATE INDEX "maps_project_id_idx" ON "maps"("project_id");

-- CreateIndex
CREATE INDEX "maps_created_by_user_id_idx" ON "maps"("created_by_user_id");

-- CreateIndex
CREATE INDEX "maps_project_id_status_idx" ON "maps"("project_id", "status");

-- CreateIndex
CREATE INDEX "maps_project_id_created_at_idx" ON "maps"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "maps_project_id_name_idx" ON "maps"("project_id", "name");

-- CreateIndex
CREATE INDEX "maps_project_id_parent_id_idx" ON "maps"("project_id", "parent_id");

-- CreateIndex
CREATE INDEX "world_elements_project_id_idx" ON "world_elements"("project_id");

-- CreateIndex
CREATE INDEX "world_elements_created_by_user_id_idx" ON "world_elements"("created_by_user_id");

-- CreateIndex
CREATE INDEX "world_elements_project_id_status_idx" ON "world_elements"("project_id", "status");

-- CreateIndex
CREATE INDEX "world_elements_project_id_created_at_idx" ON "world_elements"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "world_elements_project_id_name_idx" ON "world_elements"("project_id", "name");

-- CreateIndex
CREATE INDEX "world_elements_project_id_category_idx" ON "world_elements"("project_id", "category");

-- CreateIndex
CREATE INDEX "events_project_id_idx" ON "events"("project_id");

-- CreateIndex
CREATE INDEX "events_created_by_user_id_idx" ON "events"("created_by_user_id");

-- CreateIndex
CREATE INDEX "events_project_id_status_idx" ON "events"("project_id", "status");

-- CreateIndex
CREATE INDEX "events_project_id_created_at_idx" ON "events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "events_project_id_title_idx" ON "events"("project_id", "title");

-- CreateIndex
CREATE INDEX "events_project_id_timeline_order_idx" ON "events"("project_id", "timeline_order");

-- CreateIndex
CREATE INDEX "events_project_id_event_type_idx" ON "events"("project_id", "event_type");

-- CreateIndex
CREATE INDEX "comments_parent_comment_id_idx" ON "comments"("parent_comment_id");

-- CreateIndex
CREATE INDEX "comments_issue_id_idx" ON "comments"("issue_id");

-- CreateIndex
CREATE INDEX "comments_created_by_user_id_created_at_idx" ON "comments"("created_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_project_id_created_at_idx" ON "comments"("project_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "comment_targets_comment_id_key" ON "comment_targets"("comment_id");

-- CreateIndex
CREATE INDEX "comment_targets_project_id_idx" ON "comment_targets"("project_id");

-- CreateIndex
CREATE INDEX "comment_target_layers_layer_id_idx" ON "comment_target_layers"("layer_id");

-- CreateIndex
CREATE INDEX "comment_target_maps_map_id_idx" ON "comment_target_maps"("map_id");

-- CreateIndex
CREATE INDEX "comment_target_characters_character_id_idx" ON "comment_target_characters"("character_id");

-- CreateIndex
CREATE INDEX "comment_target_factions_faction_id_idx" ON "comment_target_factions"("faction_id");

-- CreateIndex
CREATE INDEX "comment_target_world_elements_world_element_id_idx" ON "comment_target_world_elements"("world_element_id");

-- CreateIndex
CREATE INDEX "comment_target_events_event_id_idx" ON "comment_target_events"("event_id");

-- CreateIndex
CREATE INDEX "comment_target_plots_plot_id_idx" ON "comment_target_plots"("plot_id");

-- CreateIndex
CREATE INDEX "comment_target_chapters_chapter_id_idx" ON "comment_target_chapters"("chapter_id");

-- CreateIndex
CREATE INDEX "comment_target_scenes_scene_id_idx" ON "comment_target_scenes"("scene_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_retry_at_created_at_idx" ON "outbox_events"("status", "next_retry_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_event_type_created_at_idx" ON "outbox_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_event_type_status_created_at_idx" ON "outbox_events"("event_type", "status", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_events_project_id_created_at_idx" ON "outbox_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_triggered_by_user_id_created_at_idx" ON "outbox_events"("triggered_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_idx" ON "outbox_events"("published_at");

-- CreateIndex
CREATE INDEX "dead_letter_events_outbox_event_id_idx" ON "dead_letter_events"("outbox_event_id");

-- CreateIndex
CREATE INDEX "dead_letter_events_root_outbox_event_id_idx" ON "dead_letter_events"("root_outbox_event_id");

-- CreateIndex
CREATE INDEX "dead_letter_events_status_created_at_idx" ON "dead_letter_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "dead_letter_events_project_id_created_at_idx" ON "dead_letter_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "dead_letter_events_status_root_outbox_event_id_idx" ON "dead_letter_events"("status", "root_outbox_event_id");

-- CreateIndex
CREATE INDEX "narrative_transitions_project_id_idx" ON "narrative_transitions"("project_id");

-- CreateIndex
CREATE INDEX "narrative_transitions_project_id_source_entity_type_source__idx" ON "narrative_transitions"("project_id", "source_entity_type", "source_entity_id");

-- CreateIndex
CREATE INDEX "narrative_transitions_declared_by_user_id_idx" ON "narrative_transitions"("declared_by_user_id");

-- CreateIndex
CREATE INDEX "transition_effects_narrative_transition_id_idx" ON "transition_effects"("narrative_transition_id");

-- CreateIndex
CREATE INDEX "transition_effects_project_id_target_entity_type_target_ent_idx" ON "transition_effects"("project_id", "target_entity_type", "target_entity_id");

-- CreateIndex
CREATE INDEX "transition_effects_narrative_transition_id_applied_at_idx" ON "transition_effects"("narrative_transition_id", "applied_at");

-- CreateIndex
CREATE INDEX "projects_owner_user_id_idx" ON "projects"("owner_user_id");

-- CreateIndex
CREATE INDEX "projects_created_by_user_id_idx" ON "projects"("created_by_user_id");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "user_projects_project_id_idx" ON "user_projects"("project_id");

-- CreateIndex
CREATE INDEX "user_projects_user_id_idx" ON "user_projects"("user_id");

-- CreateIndex
CREATE INDEX "user_projects_invited_by_user_id_idx" ON "user_projects"("invited_by_user_id");

-- CreateIndex
CREATE INDEX "user_projects_project_id_status_idx" ON "user_projects"("project_id", "status");

-- CreateIndex
CREATE INDEX "user_projects_project_id_role_status_idx" ON "user_projects"("project_id", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_invitations_token_hash_key" ON "project_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "project_invitations_project_id_idx" ON "project_invitations"("project_id");

-- CreateIndex
CREATE INDEX "project_invitations_email_idx" ON "project_invitations"("email");

-- CreateIndex
CREATE INDEX "project_invitations_invited_user_id_idx" ON "project_invitations"("invited_user_id");

-- CreateIndex
CREATE INDEX "project_invitations_invited_by_user_id_idx" ON "project_invitations"("invited_by_user_id");

-- CreateIndex
CREATE INDEX "project_invitations_status_idx" ON "project_invitations"("status");

-- CreateIndex
CREATE INDEX "project_invitations_expires_at_idx" ON "project_invitations"("expires_at");

-- CreateIndex
CREATE INDEX "project_ownership_transfers_project_id_idx" ON "project_ownership_transfers"("project_id");

-- CreateIndex
CREATE INDEX "project_ownership_transfers_from_user_id_idx" ON "project_ownership_transfers"("from_user_id");

-- CreateIndex
CREATE INDEX "project_ownership_transfers_to_user_id_idx" ON "project_ownership_transfers"("to_user_id");

-- CreateIndex
CREATE INDEX "project_ownership_transfers_requested_by_user_id_idx" ON "project_ownership_transfers"("requested_by_user_id");

-- CreateIndex
CREATE INDEX "project_ownership_transfers_status_idx" ON "project_ownership_transfers"("status");

-- CreateIndex
CREATE INDEX "project_ownership_transfers_expires_at_idx" ON "project_ownership_transfers"("expires_at");

-- CreateIndex
CREATE INDEX "rules_project_id_is_active_idx" ON "rules"("project_id", "is_active");

-- CreateIndex
CREATE INDEX "rules_project_id_category_idx" ON "rules"("project_id", "category");

-- CreateIndex
CREATE INDEX "rules_template_id_idx" ON "rules"("template_id");

-- CreateIndex
CREATE INDEX "rule_versions_rule_id_version_idx" ON "rule_versions"("rule_id", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "rule_versions_rule_id_version_key" ON "rule_versions"("rule_id", "version");

-- CreateIndex
CREATE INDEX "rule_dependency_index_project_id_entity_type_attribute_name_idx" ON "rule_dependency_index"("project_id", "entity_type", "attribute_name");

-- CreateIndex
CREATE INDEX "rule_dependency_index_rule_id_idx" ON "rule_dependency_index"("rule_id");

-- CreateIndex
CREATE INDEX "validation_requests_project_id_status_idx" ON "validation_requests"("project_id", "status");

-- CreateIndex
CREATE INDEX "validation_requests_project_id_scope_entity_id_idx" ON "validation_requests"("project_id", "scope", "entity_id");

-- CreateIndex
CREATE INDEX "findings_project_id_validation_request_id_idx" ON "findings"("project_id", "validation_request_id");

-- CreateIndex
CREATE INDEX "findings_project_id_issue_id_idx" ON "findings"("project_id", "issue_id");

-- CreateIndex
CREATE INDEX "issues_project_id_status_idx" ON "issues"("project_id", "status");

-- CreateIndex
CREATE INDEX "issues_project_id_rule_id_idx" ON "issues"("project_id", "rule_id");

-- CreateIndex
CREATE INDEX "issues_project_id_severity_status_idx" ON "issues"("project_id", "severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "issues_project_id_fingerprint_key" ON "issues"("project_id", "fingerprint");

-- CreateIndex
CREATE INDEX "issue_targets_issue_id_idx" ON "issue_targets"("issue_id");

-- CreateIndex
CREATE INDEX "issue_targets_entity_type_entity_id_idx" ON "issue_targets"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_targets_issue_id_entity_id_entity_type_key" ON "issue_targets"("issue_id", "entity_id", "entity_type");

-- CreateIndex
CREATE INDEX "evaluation_nodes_project_id_entity_type_idx" ON "evaluation_nodes"("project_id", "entity_type");

-- CreateIndex
CREATE INDEX "evaluation_nodes_project_id_entity_type_timeline_position_idx" ON "evaluation_nodes"("project_id", "entity_type", "timeline_position");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_nodes_project_id_entity_id_key" ON "evaluation_nodes"("project_id", "entity_id");

-- CreateIndex
CREATE INDEX "evaluation_edges_project_id_source_node_id_idx" ON "evaluation_edges"("project_id", "source_node_id");

-- CreateIndex
CREATE INDEX "evaluation_edges_project_id_target_node_id_idx" ON "evaluation_edges"("project_id", "target_node_id");

-- CreateIndex
CREATE INDEX "evaluation_edges_project_id_relationship_type_idx" ON "evaluation_edges"("project_id", "relationship_type");

-- CreateIndex
CREATE INDEX "rule_templates_scope_is_verified_idx" ON "rule_templates"("scope", "is_verified");

-- CreateIndex
CREATE INDEX "rule_templates_scope_usage_count_idx" ON "rule_templates"("scope", "usage_count" DESC);

-- CreateIndex
CREATE INDEX "rule_templates_created_by_idx" ON "rule_templates"("created_by");

-- CreateIndex
CREATE INDEX "rule_template_tags_tag_idx" ON "rule_template_tags"("tag");

-- CreateIndex
CREATE INDEX "template_versions_template_id_version_idx" ON "template_versions"("template_id", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "template_versions_template_id_version_key" ON "template_versions"("template_id", "version");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_chat_message_id_fkey" FOREIGN KEY ("chat_message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_content_revision_id_fkey" FOREIGN KEY ("content_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_parent_token_id_fkey" FOREIGN KEY ("parent_token_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_token_id_fkey" FOREIGN KEY ("replaced_by_token_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_relationships" ADD CONSTRAINT "content_relationships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_relationships" ADD CONSTRAINT "content_relationships_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maps" ADD CONSTRAINT "maps_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maps" ADD CONSTRAINT "maps_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maps" ADD CONSTRAINT "maps_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maps" ADD CONSTRAINT "maps_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_elements" ADD CONSTRAINT "world_elements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_elements" ADD CONSTRAINT "world_elements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_elements" ADD CONSTRAINT "world_elements_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_targets" ADD CONSTRAINT "comment_targets_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_targets" ADD CONSTRAINT "comment_targets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_layers" ADD CONSTRAINT "comment_target_layers_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_layers" ADD CONSTRAINT "comment_target_layers_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_maps" ADD CONSTRAINT "comment_target_maps_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_maps" ADD CONSTRAINT "comment_target_maps_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_characters" ADD CONSTRAINT "comment_target_characters_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_characters" ADD CONSTRAINT "comment_target_characters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_factions" ADD CONSTRAINT "comment_target_factions_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_factions" ADD CONSTRAINT "comment_target_factions_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_world_elements" ADD CONSTRAINT "comment_target_world_elements_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_world_elements" ADD CONSTRAINT "comment_target_world_elements_world_element_id_fkey" FOREIGN KEY ("world_element_id") REFERENCES "world_elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_events" ADD CONSTRAINT "comment_target_events_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_events" ADD CONSTRAINT "comment_target_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_plots" ADD CONSTRAINT "comment_target_plots_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_plots" ADD CONSTRAINT "comment_target_plots_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_chapters" ADD CONSTRAINT "comment_target_chapters_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_chapters" ADD CONSTRAINT "comment_target_chapters_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_scenes" ADD CONSTRAINT "comment_target_scenes_comment_target_id_fkey" FOREIGN KEY ("comment_target_id") REFERENCES "comment_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_target_scenes" ADD CONSTRAINT "comment_target_scenes_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_root_outbox_event_id_fkey" FOREIGN KEY ("root_outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_replayed_as_outbox_event_id_fkey" FOREIGN KEY ("replayed_as_outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_replayed_from_dead_letter_id_fkey" FOREIGN KEY ("replayed_from_dead_letter_id") REFERENCES "dead_letter_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narrative_transitions" ADD CONSTRAINT "narrative_transitions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narrative_transitions" ADD CONSTRAINT "narrative_transitions_declared_by_user_id_fkey" FOREIGN KEY ("declared_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narrative_transitions" ADD CONSTRAINT "narrative_transitions_reverses_transition_id_fkey" FOREIGN KEY ("reverses_transition_id") REFERENCES "narrative_transitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_effects" ADD CONSTRAINT "transition_effects_narrative_transition_id_fkey" FOREIGN KEY ("narrative_transition_id") REFERENCES "narrative_transitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ownership_transfers" ADD CONSTRAINT "project_ownership_transfers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ownership_transfers" ADD CONSTRAINT "project_ownership_transfers_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ownership_transfers" ADD CONSTRAINT "project_ownership_transfers_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ownership_transfers" ADD CONSTRAINT "project_ownership_transfers_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "rule_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_dependency_index" ADD CONSTRAINT "rule_dependency_index_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_requests" ADD CONSTRAINT "validation_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_validation_request_id_fkey" FOREIGN KEY ("validation_request_id") REFERENCES "validation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_targets" ADD CONSTRAINT "issue_targets_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_edges" ADD CONSTRAINT "evaluation_edges_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "evaluation_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_edges" ADD CONSTRAINT "evaluation_edges_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "evaluation_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_templates" ADD CONSTRAINT "rule_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_template_tags" ADD CONSTRAINT "rule_template_tags_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "rule_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "rule_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

