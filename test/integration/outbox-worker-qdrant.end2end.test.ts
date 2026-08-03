import { once } from "node:events";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createAppContainer } from "../../src/infrastructure/container.js";
import { createRabbitMqConsumer, type RabbitMqMessage } from "../../src/infrastructure/queue/consumer.js";
import { computeContentHash } from "../../src/shared/embedding/contentHash.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { ContentEventType, EmbeddingWorker } from "../../src/infrastructure/embedding/EmbeddingWorker.js";
import type { OutboxDispatcher } from "../../src/infrastructure/outbox/outboxDispatcher.js";
import type { RabbitMqManager } from "../../src/infrastructure/queue/rabbitmqManager.js";
import type { Consumer } from "../../src/shared/application/ports/Consumer.js";
import type { VectorIndex } from "../../src/shared/application/ports/VectorIndex.js";

// 5.4 (07-implementation-order/01_implementation_order.md) — the full real pipeline, no
// mocking at any hop: HTTP request -> LayerService -> Postgres (content_revisions +
// outbox_events, one transaction) -> real OutboxDispatcher polling & publishing -> real
// RabbitMQ -> a test-scoped consumer wrapping the real EmbeddingWorker -> real
// ContentEntityReader reading back from Postgres -> real chunker/canonical text -> real
// LocalEmbeddingProvider (actual CPU model inference) -> real Qdrant upsert/delete.
//
// Deliberately does NOT resolve container.resolve("embeddingWorkerConsumer") (the
// production wiring — that exact factory call is already verified by
// embeddingWorkerConsumer.test.ts's mock-based wiring assertions). Content.* is a topic
// exchange: any consumer bound with a matching pattern gets its own copy of EVERY message,
// regardless of queue name. Binding to the production queue name/pattern here means this
// test's dispatcher would also process the real backlog other integration tests leave
// behind (e.g. content.end2end.test.ts creates 15 real content.* events without ever
// starting a dispatcher) — full real model inference for every one of them, which both
// slowed the whole suite down (measured: ~72s vs ~119s tests-phase with this contention)
// and made this test itself time out under full-suite parallelism. Instead: a unique
// per-run queue (same isolation pattern as consumer-retry-dlq.integration.test.ts) whose
// handler filters to this test's own projectId before invoking the real embeddingWorker —
// any other test's traffic is acked and ignored immediately, cheaply, instead of triggering
// a real (and irrelevant) embedding pipeline run.
const EMAIL_SUFFIX = "@outbox-worker-qdrant-e2e.test";
const PASSWORD = "CorrectPassword1!";
// Generous: covers a possible cold model load (first run downloads
// Xenova/paraphrase-multilingual-mpnet-base-v2, see local-embedding-provider.smoke.test.ts)
// plus the outbox dispatcher's ~1s poll interval plus real Qdrant round-trips.
const PIPELINE_TIMEOUT_MS = 60_000;

type JsonObject = Record<string, unknown>;

let server: ReturnType<typeof serve>;
let baseUrl: string;
let prisma: PrismaClient;
let rabbitmq: RabbitMqManager;
let outboxDispatcher: OutboxDispatcher;
let scopedConsumer: Consumer;
let vectorIndex: VectorIndex;
// Set once the test creates its own project — the scoped consumer's handler ignores any
// message whose payload doesn't match, so other tests' concurrent real content.* traffic
// (received regardless of queue name, since content.* is a topic exchange) never reaches
// the real embeddingWorker.
let allowedProjectId: string | null = null;

function emailFor(name: string): string {
  return `${name}${EMAIL_SUFFIX}`;
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<Response> {
  const headers = new Headers({ "x-request-id": `e2e-${crypto.randomUUID()}` });

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (options.accessToken) {
    headers.set("authorization", `Bearer ${options.accessToken}`);
  }

  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function readJson(response: Response): Promise<JsonObject> {
  return response.json() as Promise<JsonObject>;
}

async function registerAndLogin(name: string): Promise<{ accessToken: string }> {
  const registerResponse = await request("/api/v1/auth/register", {
    method: "POST",
    body: {
      email: emailFor(name),
      password: PASSWORD,
      confirmPassword: PASSWORD,
      username: name,
      displayName: `Writer ${name}`,
    },
  });

  expect(registerResponse.status).toBe(201);

  const loginResponse = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email: emailFor(name), password: PASSWORD },
  });
  const payload = await readJson(loginResponse);

  expect(loginResponse.status).toBe(200);

  return { accessToken: (payload.data as JsonObject).accessToken as string };
}

async function createProject(accessToken: string, name: string): Promise<string> {
  const response = await request("/api/v1/projects", {
    method: "POST",
    accessToken,
    body: { name },
  });

  expect(response.status).toBe(201);
  const payload = await readJson(response);

  return (payload.data as JsonObject).projectId as string;
}

beforeAll(async () => {
  process.env.JWT_SECRET = "outbox-worker-qdrant-e2e-test-secret";

  const container = createAppContainer();
  const app = createApp(container);

  prisma = container.resolve("prisma");
  rabbitmq = container.resolve("rabbitmq");
  outboxDispatcher = container.resolve("outboxDispatcher");
  vectorIndex = container.resolve("vectorIndex");

  const embeddingWorker: EmbeddingWorker = container.resolve("embeddingWorker");

  scopedConsumer = createRabbitMqConsumer(rabbitmq, {
    queue: `embedding-worker-e2e-${crypto.randomUUID()}`,
    routingKeyPattern: "content.*",
    handleMessage: async (message: RabbitMqMessage) => {
      const payload = message.payload as { projectId?: string };

      if (payload.projectId !== allowedProjectId) {
        return;
      }

      await embeddingWorker.handleContentEvent(
        message.routingKey as ContentEventType,
        message.payload as never,
      );
    },
  });

  server = serve({ fetch: app.fetch, port: 0 });
  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("E2E server did not expose a TCP port");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;

  // Other integration tests (e.g. content.end2end.test.ts) create real content through
  // real Services/transactions without ever starting a dispatcher — their outbox_events
  // rows are left "pending" forever from their own point of view. Since outboxDispatcher
  // claims globally (by design, matching production), starting it here would otherwise
  // greedily process that unrelated backlog first — each one a real content.* event this
  // consumer would try to embed — before ever reaching the row this test cares about.
  // Same precedent as outbox-dispatcher.smoke.test.ts's own beforeEach wipe.
  await prisma.deadLetterEvent.deleteMany({});
  await prisma.outboxEvent.deleteMany({});

  await rabbitmq.start();
  await vectorIndex.ensureCollection();
  await outboxDispatcher.start();
  await scopedConsumer.start();
}, PIPELINE_TIMEOUT_MS);

afterAll(async () => {
  await scopedConsumer.stop();
  await outboxDispatcher.stop();
  await rabbitmq.stop();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const users = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  if (userIds.length > 0) {
    const projects = await prisma.project.findMany({
      where: { ownerUserId: { in: userIds } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    if (projectIds.length > 0) {
      // ai_usage_logs has onDelete: Restrict on project_id — the embedding worker really
      // did write rows here (AiUsageLogWriter), so they must go before the project does.
      await prisma.aiUsageLog.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.layer.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.contentRevision.deleteMany({ where: { projectId: { in: projectIds } } });
    }

    await prisma.userProject.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.project.deleteMany({ where: { ownerUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.$disconnect();
});

describe("outbox -> embedding worker -> Qdrant (5.4)", () => {
  it(
    "indexes a created layer, re-embeds only the changed field on partial update, and cleans up on delete",
    async () => {
      const session = await registerAndLogin("outbox-worker-qdrant");
      const projectId = await createProject(session.accessToken, "Pipeline E2E Project");

      allowedProjectId = projectId;

      const createResponse = await request(`/api/v1/projects/${projectId}/layers`, {
        method: "POST",
        accessToken: session.accessToken,
        body: {
          name: "Ground Floor",
          level: 1,
          exposure: "reader_visible",
          description: "Base layer of the tower",
        },
      });

      expect(createResponse.status).toBe(201);
      const createPayload = await readJson(createResponse);
      const layerId = (createPayload.data as JsonObject).layerId as string;

      // content.created -> outbox -> RabbitMQ -> scoped consumer -> real EmbeddingWorker -> real upsert.
      await expect
        .poll(
          async () =>
            vectorIndex.getFieldProvenance({
              projectId,
              entityType: "layer",
              entityId: layerId,
              contentField: "name",
            }),
          { timeout: PIPELINE_TIMEOUT_MS },
        )
        .toMatchObject({ contentHash: computeContentHash("Ground Floor") });

      const descriptionProvenanceAfterCreate = await vectorIndex.getFieldProvenance({
        projectId,
        entityType: "layer",
        entityId: layerId,
        contentField: "description",
      });

      expect(descriptionProvenanceAfterCreate).toMatchObject({
        contentHash: computeContentHash("Base layer of the tower"),
      });

      const exposureProvenanceAfterCreate = await vectorIndex.getFieldProvenance({
        projectId,
        entityType: "layer",
        entityId: layerId,
        contentField: "exposure",
      });

      expect(exposureProvenanceAfterCreate).toMatchObject({
        contentHash: computeContentHash("reader_visible"),
      });

      // Partial update — only `name` changes. content.updated fires a new revisionId for
      // the WHOLE entity, but §18's per-field content_hash check must still leave
      // `description`/`exposure` alone (proves the skip decision is genuinely per-field,
      // not a blanket "new revision -> re-embed everything").
      const updateResponse = await request(`/api/v1/projects/${projectId}/layers/${layerId}`, {
        method: "PATCH",
        accessToken: session.accessToken,
        body: { name: "Ground Floor Renamed" },
      });

      expect(updateResponse.status).toBe(200);

      await expect
        .poll(
          async () =>
            vectorIndex.getFieldProvenance({
              projectId,
              entityType: "layer",
              entityId: layerId,
              contentField: "name",
            }),
          { timeout: PIPELINE_TIMEOUT_MS },
        )
        .toMatchObject({ contentHash: computeContentHash("Ground Floor Renamed") });

      // Unchanged fields keep the exact same stored provenance — never touched.
      await expect(
        vectorIndex.getFieldProvenance({
          projectId,
          entityType: "layer",
          entityId: layerId,
          contentField: "description",
        }),
      ).resolves.toEqual(descriptionProvenanceAfterCreate);
      await expect(
        vectorIndex.getFieldProvenance({
          projectId,
          entityType: "layer",
          entityId: layerId,
          contentField: "exposure",
        }),
      ).resolves.toEqual(exposureProvenanceAfterCreate);

      // content.deleted -> deletePointsForEntity — every field's points gone.
      const deleteResponse = await request(`/api/v1/projects/${projectId}/layers/${layerId}`, {
        method: "DELETE",
        accessToken: session.accessToken,
      });

      expect(deleteResponse.status).toBe(200);

      await expect
        .poll(
          async () =>
            vectorIndex.getFieldProvenance({
              projectId,
              entityType: "layer",
              entityId: layerId,
              contentField: "name",
            }),
          { timeout: PIPELINE_TIMEOUT_MS },
        )
        .toBeNull();

      await expect(
        vectorIndex.getFieldProvenance({
          projectId,
          entityType: "layer",
          entityId: layerId,
          contentField: "description",
        }),
      ).resolves.toBeNull();
    },
    PIPELINE_TIMEOUT_MS,
  );
});
