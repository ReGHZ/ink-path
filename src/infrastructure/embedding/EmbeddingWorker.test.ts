import { describe, expect, it, vi } from "vitest";

import { EmbeddingWorker } from "./EmbeddingWorker.js";
import { computeChunkerSourceHash } from "../../shared/embedding/chunkerSourceHash.js";
import { computeContentHash } from "../../shared/embedding/contentHash.js";

import type { AiUsageLogWriter } from "../../shared/application/ports/AiUsageLogWriter.js";
import type {
  ContentEntityReader,
  IndexableContentEntity,
} from "../../shared/application/ports/ContentEntityReader.js";
import type { EmbeddingProvider } from "../../shared/application/ports/EmbeddingProvider.js";
import type { FieldProvenance, VectorIndex } from "../../shared/application/ports/VectorIndex.js";

const PROVIDER_NAME = "stub-provider";
const MODEL_NAME = "stub-model";
const EMBEDDING_VERSION = "1";

const BASE_PAYLOAD = {
  projectId: "project-1",
  entityType: "layer",
  entityId: "entity-1",
  revisionId: "revision-1",
  revisionNumber: 1,
  changedByUserId: "user-1",
};

function makeEntity(
  overrides: Partial<IndexableContentEntity> = {},
): IndexableContentEntity {
  return {
    projectId: "project-1",
    entityName: "The Undercity",
    currentRevisionId: "revision-1",
    content: null,
    fields: {
      name: { value: "The Undercity", classification: "short" },
      description: { value: null, classification: "medium" },
    },
    ...overrides,
  };
}

// vi.fn() references are kept as named consts (not read back off the returned port
// object) — asserting via `object.method` trips @typescript-eslint/unbound-method,
// since the member's declared type comes from the port interface's method signature.
function makeReader(entity: IndexableContentEntity | null) {
  const read = vi.fn().mockResolvedValue(entity);
  const instance: ContentEntityReader = { read };

  return { instance, read };
}

function makeProvider(overrides: { embedBatch?: ReturnType<typeof vi.fn> } = {}) {
  const embed = vi.fn();
  const embedBatch =
    overrides.embedBatch ??
    vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(
          texts.map(() => ({ vector: [0.1, 0.2, 0.3], model: MODEL_NAME, dimension: 3 })),
        ),
      );
  const getTokenCounter = vi
    .fn()
    .mockResolvedValue((text: string) => text.split(/\s+/).length);
  const instance: EmbeddingProvider = {
    providerName: PROVIDER_NAME,
    model: MODEL_NAME,
    dimension: 3,
    embed,
    embedBatch: embedBatch as EmbeddingProvider["embedBatch"],
    getTokenCounter,
  };

  return { instance, embed, embedBatch, getTokenCounter };
}

function makeVectorIndex(
  overrides: { getFieldProvenance?: ReturnType<typeof vi.fn> } = {},
) {
  const ensureCollection = vi.fn();
  const upsertPoints = vi.fn().mockResolvedValue(undefined);
  const deletePointsForEntity = vi.fn().mockResolvedValue(undefined);
  const deletePointsForField = vi.fn().mockResolvedValue(undefined);
  const getFieldProvenance =
    overrides.getFieldProvenance ?? vi.fn().mockResolvedValue(null);
  const instance: VectorIndex = {
    ensureCollection,
    upsertPoints,
    deletePointsForEntity,
    deletePointsForField,
    getFieldProvenance: getFieldProvenance as VectorIndex["getFieldProvenance"],
  };

  return {
    instance,
    ensureCollection,
    upsertPoints,
    deletePointsForEntity,
    deletePointsForField,
    getFieldProvenance,
  };
}

function makeLogWriter() {
  const begin = vi.fn().mockResolvedValue("log-1");
  const complete = vi.fn().mockResolvedValue(undefined);
  const instance: AiUsageLogWriter = { begin, complete };

  return { instance, begin, complete };
}

describe("EmbeddingWorker.handleContentEvent — content.deleted", () => {
  it("deletes all points for the entity and never touches the content entity reader", async () => {
    const reader = makeReader(null);
    const vectorIndex = makeVectorIndex();
    const worker = new EmbeddingWorker(
      reader.instance,
      makeProvider().instance,
      vectorIndex.instance,
      makeLogWriter().instance,
    );

    await worker.handleContentEvent("content.deleted", BASE_PAYLOAD);

    expect(vectorIndex.deletePointsForEntity).toHaveBeenCalledWith({
      projectId: "project-1",
      entityType: "layer",
      entityId: "entity-1",
    });
    expect(reader.read).not.toHaveBeenCalled();
  });
});

describe("EmbeddingWorker.handleContentEvent — guards", () => {
  it("does nothing when the entity is not found", async () => {
    const vectorIndex = makeVectorIndex();
    const worker = new EmbeddingWorker(
      makeReader(null).instance,
      makeProvider().instance,
      vectorIndex.instance,
      makeLogWriter().instance,
    );

    await worker.handleContentEvent("content.created", BASE_PAYLOAD);

    expect(vectorIndex.getFieldProvenance).not.toHaveBeenCalled();
  });

  it("does nothing when the event's revisionId is stale (doesn't match the entity's current revision)", async () => {
    const entity = makeEntity({ currentRevisionId: "some-other-revision" });
    const vectorIndex = makeVectorIndex();
    const worker = new EmbeddingWorker(
      makeReader(entity).instance,
      makeProvider().instance,
      vectorIndex.instance,
      makeLogWriter().instance,
    );

    await worker.handleContentEvent("content.updated", BASE_PAYLOAD);

    expect(vectorIndex.getFieldProvenance).not.toHaveBeenCalled();
  });
});

describe("EmbeddingWorker.handleContentEvent — happy path", () => {
  it("chunks changed fields, deletes-before-upserts, embeds once in a batch, and logs success", async () => {
    const entity = makeEntity({
      fields: {
        name: { value: "The Undercity", classification: "short" },
        description: { value: "A hidden layer beneath the city.", classification: "medium" },
      },
    });
    const vectorIndex = makeVectorIndex();
    const provider = makeProvider();
    const logWriter = makeLogWriter();
    const worker = new EmbeddingWorker(
      makeReader(entity).instance,
      provider.instance,
      vectorIndex.instance,
      logWriter.instance,
    );

    const callOrder: string[] = [];

    vectorIndex.deletePointsForField.mockImplementation(() => {
      callOrder.push("delete");
      return Promise.resolve();
    });
    vectorIndex.upsertPoints.mockImplementation(() => {
      callOrder.push("upsert");
      return Promise.resolve();
    });

    await worker.handleContentEvent("content.created", BASE_PAYLOAD);

    // name (short) + description (medium, single chunk since short text) = 2 chunks total.
    expect(provider.embedBatch).toHaveBeenCalledTimes(1);
    // name (short) + description (medium) contribute a chunk each; "content" is null on
    // this entity, so it's still deleted below (no prior provenance either) but
    // contributes zero chunks to embed.
    expect(provider.embedBatch.mock.calls[0]?.[0]).toHaveLength(2);

    expect(vectorIndex.deletePointsForField).toHaveBeenCalledWith(
      expect.objectContaining({ contentField: "name" }),
    );
    expect(vectorIndex.deletePointsForField).toHaveBeenCalledWith(
      expect.objectContaining({ contentField: "description" }),
    );
    expect(vectorIndex.deletePointsForField).toHaveBeenCalledWith(
      expect.objectContaining({ contentField: "content" }),
    );
    expect(vectorIndex.deletePointsForField).toHaveBeenCalledTimes(3);

    // Delete-before-upsert (§17 step 11, addendum 2026-08-03).
    expect(callOrder).toEqual(["delete", "delete", "delete", "upsert"]);

    expect(logWriter.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        triggeredByUserId: "user-1",
        provider: PROVIDER_NAME,
        model: MODEL_NAME,
        contentRevisionId: "revision-1",
        contextEntityType: "layer",
        contextEntityId: "entity-1",
      }),
    );
    expect(logWriter.complete).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ status: "success" }),
    );
  });

  it("skips a field entirely (no delete, no chunk, no embed call for it) when its provenance matches exactly", async () => {
    const fieldValue = "A hidden layer beneath the city.";
    const matchingProvenance: FieldProvenance = {
      contentHash: computeContentHash(fieldValue),
      icuVersion: process.versions.icu ?? "unknown",
      chunkerSourceHash: computeChunkerSourceHash(),
      embeddingProvider: PROVIDER_NAME,
      embeddingModel: MODEL_NAME,
      embeddingVersion: EMBEDDING_VERSION,
    };

    const entity = makeEntity({
      fields: {
        description: { value: fieldValue, classification: "medium" },
      },
    });
    const vectorIndex = makeVectorIndex({
      getFieldProvenance: vi
        .fn()
        .mockImplementation(({ contentField }: { contentField: string }) =>
          Promise.resolve(contentField === "description" ? matchingProvenance : null),
        ),
    });
    const provider = makeProvider();
    const logWriter = makeLogWriter();
    const worker = new EmbeddingWorker(
      makeReader(entity).instance,
      provider.instance,
      vectorIndex.instance,
      logWriter.instance,
    );

    await worker.handleContentEvent("content.updated", BASE_PAYLOAD);

    expect(vectorIndex.deletePointsForField).not.toHaveBeenCalledWith(
      expect.objectContaining({ contentField: "description" }),
    );
    // Nothing else changed on this entity either -> nothing to embed at all.
    expect(provider.embedBatch).not.toHaveBeenCalled();
    expect(logWriter.begin).not.toHaveBeenCalled();
  });

  it("deletes a field's stale points but embeds nothing when the field's value became empty", async () => {
    const entity = makeEntity({
      fields: {
        description: { value: "", classification: "medium" },
      },
    });
    const vectorIndex = makeVectorIndex({
      getFieldProvenance: vi.fn().mockResolvedValue({
        contentHash: computeContentHash("previously had text"),
        icuVersion: "some-other-icu",
        chunkerSourceHash: "irrelevant",
        embeddingProvider: PROVIDER_NAME,
        embeddingModel: MODEL_NAME,
        embeddingVersion: EMBEDDING_VERSION,
      } satisfies FieldProvenance),
    });
    const provider = makeProvider();
    const logWriter = makeLogWriter();
    const worker = new EmbeddingWorker(
      makeReader(entity).instance,
      provider.instance,
      vectorIndex.instance,
      logWriter.instance,
    );

    await worker.handleContentEvent("content.updated", BASE_PAYLOAD);

    expect(vectorIndex.deletePointsForField).toHaveBeenCalledWith(
      expect.objectContaining({ contentField: "description" }),
    );
    expect(provider.embedBatch).not.toHaveBeenCalled();
    expect(logWriter.begin).not.toHaveBeenCalled();
  });

  it("logs failure and re-throws when the embedding provider call fails, without ever calling upsertPoints", async () => {
    const entity = makeEntity({
      fields: {
        name: { value: "The Undercity", classification: "short" },
      },
    });
    const vectorIndex = makeVectorIndex();
    const provider = makeProvider({
      embedBatch: vi.fn().mockRejectedValue(new Error("provider unreachable")),
    });
    const logWriter = makeLogWriter();
    const worker = new EmbeddingWorker(
      makeReader(entity).instance,
      provider.instance,
      vectorIndex.instance,
      logWriter.instance,
    );

    await expect(
      worker.handleContentEvent("content.created", BASE_PAYLOAD),
    ).rejects.toThrow("provider unreachable");

    expect(vectorIndex.upsertPoints).not.toHaveBeenCalled();
    expect(logWriter.complete).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ status: "failed", errorMessage: "provider unreachable" }),
    );
  });
});
