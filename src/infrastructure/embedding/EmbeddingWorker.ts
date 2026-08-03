import {
  buildMediumOrLongFieldCanonicalText,
  buildShortFieldCanonicalText,
} from "../../shared/embedding/canonicalText.js";
import { chunkText } from "../../shared/embedding/chunker.js";
import { computeChunkerSourceHash } from "../../shared/embedding/chunkerSourceHash.js";
import { computeContentHash } from "../../shared/embedding/contentHash.js";
import { buildQdrantPoint } from "../../shared/embedding/qdrantPayload.js";
import { logger } from "../logger.js";

import type { AiUsageLogWriter } from "../../shared/application/ports/AiUsageLogWriter.js";
import type { ContentEntityReader } from "../../shared/application/ports/ContentEntityReader.js";
import type { EmbeddingProvider } from "../../shared/application/ports/EmbeddingProvider.js";
import type {
  VectorIndex,
  VectorIndexPoint,
} from "../../shared/application/ports/VectorIndex.js";

// 05-implementation-policy/03_qdrant_point_id_chunking.md:§17 — the payload every
// content.created/content.updated/content.deleted outbox event carries (see e.g.
// LayerService's outboxEvent.insert() calls), independent of which entity type it's about.
export type ContentEventType =
  | "content.created"
  | "content.updated"
  | "content.deleted";

export type ContentEventPayload = {
  projectId: string;
  entityType: string;
  entityId: string;
  revisionId: string;
  revisionNumber: number;
  changedByUserId: string;
};

// Bumped only if HOW the provider is called changes in a way that changes the resulting
// vectors' meaning without necessarily changing `embedding_model` itself (e.g. a different
// canonical-text template). Independent of chunker_source_hash (chunking algorithm
// identity) and embedding_model (which model) — all three are separate §18 skip inputs.
const EMBEDDING_VERSION = "1";

// Node builds without full ICU data don't set process.versions.icu at all (@types/node
// types it as possibly undefined via ProcessVersions' index signature) — this project
// requires full-icu for Intl.Segmenter (§12) regardless, so hitting this fallback would
// mean something is already badly wrong with the runtime. Falling back to a fixed
// placeholder rather than throwing keeps the worker itself from being the thing that
// crashes on a config problem better surfaced elsewhere.
function currentIcuVersion(): string {
  return process.versions.icu ?? "unknown";
}

type PendingChunk = {
  fieldName: string;
  chunkIndex: number;
  chunkCount: number;
  canonicalText: string;
  contentHash: string;
};

export class EmbeddingWorker {
  constructor(
    private readonly contentEntityReader: ContentEntityReader,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorIndex: VectorIndex,
    private readonly aiUsageLogWriter: AiUsageLogWriter,
  ) {}

  async handleContentEvent(
    eventType: ContentEventType,
    payload: ContentEventPayload,
  ): Promise<void> {
    if (eventType === "content.deleted") {
      await this.vectorIndex.deletePointsForEntity({
        projectId: payload.projectId,
        entityType: payload.entityType,
        entityId: payload.entityId,
      });

      return;
    }

    await this.handleUpsert(payload);
  }

  private async handleUpsert(payload: ContentEventPayload): Promise<void> {
    const entity = await this.contentEntityReader.read({
      entityType: payload.entityType,
      entityId: payload.entityId,
    });

    if (!entity) {
      logger.warn(
        { entityType: payload.entityType, entityId: payload.entityId },
        "Embedding worker: entity not found, skipping (likely deleted after event was enqueued)",
      );

      return;
    }

    // §4/§17 step 4-5 — stale event guard. Events can be processed out of order; only the
    // event matching the entity's CURRENT revision is allowed to (re)index it.
    if (entity.currentRevisionId !== payload.revisionId) {
      logger.info(
        {
          entityType: payload.entityType,
          entityId: payload.entityId,
          eventRevisionId: payload.revisionId,
          currentRevisionId: entity.currentRevisionId,
        },
        "Embedding worker: stale event, skipping",
      );

      return;
    }

    const countTokens = await this.embeddingProvider.getTokenCounter();
    const chunkerSourceHash = computeChunkerSourceHash();
    const icuVersion = currentIcuVersion();

    const fieldsToDelete: string[] = [];
    const pendingChunks: PendingChunk[] = [];

    const fieldEntries: Array<{
      fieldName: string;
      value: string | null;
      classification: "short" | "medium" | "long";
    }> = [
      ...Object.entries(entity.fields).map(([fieldName, field]) => ({
        fieldName,
        value: field.value,
        classification: field.classification,
      })),
      { fieldName: "content", value: entity.content, classification: "long" as const },
    ];

    for (const fieldEntry of fieldEntries) {
      const value = (fieldEntry.value ?? "").trim();
      const contentHash = computeContentHash(value);

      const provenance = await this.vectorIndex.getFieldProvenance({
        projectId: payload.projectId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        contentField: fieldEntry.fieldName,
      });

      // §18 — skip the WHOLE pipeline (chunk -> delete -> upsert) for this field only if
      // every one of these six matches the last successful run for it.
      const isUnchanged =
        provenance !== null &&
        provenance.contentHash === contentHash &&
        provenance.icuVersion === icuVersion &&
        provenance.chunkerSourceHash === chunkerSourceHash &&
        provenance.embeddingProvider === this.embeddingProvider.providerName &&
        provenance.embeddingModel === this.embeddingProvider.model &&
        provenance.embeddingVersion === EMBEDDING_VERSION;

      if (isUnchanged) {
        continue;
      }

      fieldsToDelete.push(fieldEntry.fieldName);

      if (value === "") {
        continue;
      }

      if (fieldEntry.classification === "short") {
        pendingChunks.push({
          fieldName: fieldEntry.fieldName,
          chunkIndex: 0,
          chunkCount: 1,
          contentHash,
          canonicalText: buildShortFieldCanonicalText({
            entityType: payload.entityType,
            entityName: entity.entityName,
            contentField: fieldEntry.fieldName,
            fieldValue: value,
          }),
        });

        continue;
      }

      const chunks = chunkText(value, { countTokens });

      for (const chunk of chunks) {
        pendingChunks.push({
          fieldName: fieldEntry.fieldName,
          chunkIndex: chunk.index,
          chunkCount: chunks.length,
          contentHash,
          canonicalText: buildMediumOrLongFieldCanonicalText({
            entityType: payload.entityType,
            entityName: entity.entityName,
            contentField: fieldEntry.fieldName,
            revisionNumber: payload.revisionNumber,
            fieldContent: chunk.text,
          }),
        });
      }
    }

    // §17 step 11 (addendum 2026-08-03) — delete BEFORE upsert, for every changed field,
    // before any new point exists. A crash between delete and upsert leaves a field
    // temporarily empty in Qdrant (self-heals: getFieldProvenance sees no points next run,
    // which is unambiguously "not skipped"), rather than upsert-then-delete's risk of a
    // crash leaving a fresh point whose content_hash already matches — which would make a
    // later run wrongly skip and never delete the stale points sitting alongside it.
    for (const fieldName of fieldsToDelete) {
      await this.vectorIndex.deletePointsForField({
        projectId: payload.projectId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        contentField: fieldName,
      });
    }

    if (pendingChunks.length === 0) {
      return;
    }

    const startedAt = new Date();
    const logId = await this.aiUsageLogWriter.begin({
      projectId: payload.projectId,
      triggeredByUserId: payload.changedByUserId,
      provider: this.embeddingProvider.providerName,
      model: this.embeddingProvider.model,
      contentRevisionId: payload.revisionId,
      contextEntityType: payload.entityType,
      contextEntityId: payload.entityId,
      startedAt,
    });

    try {
      const embeddings = await this.embeddingProvider.embedBatch(
        pendingChunks.map((chunk) => chunk.canonicalText),
      );

      const points: VectorIndexPoint[] = pendingChunks.map((chunk, index) => {
        const embedding = embeddings[index];

        if (!embedding) {
          throw new Error(
            `Embedding provider returned fewer results (${embeddings.length}) than requested (${pendingChunks.length})`,
          );
        }

        const point = buildQdrantPoint({
          projectId: payload.projectId,
          entityType: payload.entityType,
          entityId: payload.entityId,
          contentField: chunk.fieldName,
          revisionId: payload.revisionId,
          revisionNumber: payload.revisionNumber,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount,
          contentHash: chunk.contentHash,
          embeddingProvider: this.embeddingProvider.providerName,
          embeddingModel: embedding.model,
          embeddingVersion: EMBEDDING_VERSION,
          icuVersion,
          chunkerSourceHash,
          now: startedAt,
        });

        return { id: point.id, vector: embedding.vector, payload: point.payload };
      });

      await this.vectorIndex.upsertPoints(points);

      const completedAt = new Date();

      await this.aiUsageLogWriter.complete(logId, {
        status: "success",
        completedAt,
        latencyMs: completedAt.getTime() - startedAt.getTime(),
      });
    } catch (error) {
      const completedAt = new Date();

      await this.aiUsageLogWriter.complete(logId, {
        status: "failed",
        completedAt,
        latencyMs: completedAt.getTime() - startedAt.getTime(),
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }
}

export function createEmbeddingWorker({
  contentEntityReader,
  embeddingProvider,
  vectorIndex,
  aiUsageLogWriter,
}: {
  contentEntityReader: ContentEntityReader;
  embeddingProvider: EmbeddingProvider;
  vectorIndex: VectorIndex;
  aiUsageLogWriter: AiUsageLogWriter;
}): EmbeddingWorker {
  return new EmbeddingWorker(
    contentEntityReader,
    embeddingProvider,
    vectorIndex,
    aiUsageLogWriter,
  );
}
