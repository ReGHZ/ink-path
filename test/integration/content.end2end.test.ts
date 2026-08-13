import { once } from "node:events";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createAppContainer } from "../../src/infrastructure/container.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const EMAIL_SUFFIX = "@content-e2e.test";
const PASSWORD = "CorrectPassword1!";

type JsonObject = Record<string, unknown>;

let server: ReturnType<typeof serve>;
let baseUrl: string;
let prisma: PrismaClient;

function emailFor(name: string): string {
  return `${name}${EMAIL_SUFFIX}`;
}

async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    accessToken?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers({
    "x-request-id": `e2e-${crypto.randomUUID()}`,
  });

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

async function registerAndLogin(
  name: string,
): Promise<{ accessToken: string; userId: string }> {
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

  const data = payload.data as JsonObject;

  return {
    accessToken: data.accessToken as string,
    userId: (data.user as JsonObject).id as string,
  };
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

async function createLayer(
  accessToken: string,
  projectId: string,
  body: JsonObject,
): Promise<string> {
  const response = await request(`/api/v1/projects/${projectId}/layers`, {
    method: "POST",
    accessToken,
    body,
  });

  expect(response.status).toBe(201);
  const payload = await readJson(response);

  return (payload.data as JsonObject).layerId as string;
}

async function createChapter(
  accessToken: string,
  projectId: string,
  body: JsonObject,
): Promise<string> {
  const response = await request(`/api/v1/projects/${projectId}/chapters`, {
    method: "POST",
    accessToken,
    body,
  });

  expect(response.status).toBe(201);
  const payload = await readJson(response);

  return (payload.data as JsonObject).chapterId as string;
}

// Seeded straight into `user_projects` rather than through an endpoint: there is
// no invitation API yet (Phase 12), and the project creator is always writer +
// canDelete, so every other point of the permission matrix is unreachable over
// HTTP today. Mirrors seedSecondMembership in project.end2end.test.ts.
async function seedMembership(
  projectId: string,
  userId: string,
  role: "writer" | "editor" | "reviewer",
  canDelete: boolean,
): Promise<void> {
  await prisma.userProject.create({
    data: {
      id: crypto.randomUUID(),
      projectId,
      userId,
      role,
      canDelete,
      aiAccess: "full",
      status: "active",
      joinedAt: new Date(),
    },
  });
}

function changeChapterStatus(
  accessToken: string,
  chapterPath: string,
  status: string,
): Promise<Response> {
  return request(`${chapterPath}/status`, {
    method: "PATCH",
    accessToken,
    body: { status },
  });
}

type EntityCase = {
  label: string;
  segment: string;
  createBody: JsonObject;
  createIdField: string;
  listField: string;
  updateBody: JsonObject;
  updateField: string;
  updateValue: unknown;
  // Target for the PATCH .../status leg. Per-entity rather than a shared
  // constant, because neither the enums nor the guards are uniform:
  //
  //   Layer/WorldMap/WorldElement/Event  draft|published      published needs `content`
  //   Plot                               draft|active|completed  active needs `content`
  //   Faction                            draft|active|archived   active needs description + background
  //   Character                          draft|active|archived   active needs archetype + background
  //                                                              + personality + description
  //
  // That is why several createBody entries below carry fields the CRUD legs
  // alone would not need — they are what each entity demands before it will
  // leave draft. Getting this wrong fails loudly (400), which is how Character's
  // four-field guard was found rather than assumed.
  //
  // Omitted only for Chapter, whose transitions are resolved as (origin,
  // target) pairs and are covered by their own dedicated test.
  statusTarget?: string;
  findPersisted: (id: string) => Promise<unknown>;
};

beforeAll(async () => {
  process.env.JWT_SECRET = "content-e2e-test-secret";

  const container = createAppContainer();
  const app = createApp(container);
  prisma = container.resolve("prisma");
  server = serve({ fetch: app.fetch, port: 0 });

  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Content E2E server did not expose a TCP port");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
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
      // Scenes before chapters: `scenes.chapter_id` is onDelete: Restrict, so the
      // reverse order fails on a leftover scene rather than cleaning up.
      await prisma.scene.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.chapter.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.event.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.plot.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.layer.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.map.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.worldElement.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.faction.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.character.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.contentRevision.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }

    await prisma.userProject.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.project.deleteMany({ where: { ownerUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await prisma.$disconnect();
});

describe("Content end-to-end", () => {
  it("round-trips create, get, update, and delete across every content entity", async () => {
    const session = await registerAndLogin("content-crud");
    const projectId = await createProject(session.accessToken, "Content CRUD Project");
    const basePath = `/api/v1/projects/${projectId}`;

    const entityCases: EntityCase[] = [
      {
        label: "layer",
        segment: "layers",
        createBody: {
          name: "Ground Floor",
          level: 1,
          exposure: "reader_visible",
          description: "Base layer of the tower",
          content: "Stone corridors ring the base of the tower.",
        },
        createIdField: "layerId",
        listField: "layers",
        updateBody: { name: "Updated Ground Floor" },
        updateField: "name",
        updateValue: "Updated Ground Floor",
        statusTarget: "published",
        findPersisted: (id) => prisma.layer.findUnique({ where: { id } }),
      },
      {
        label: "world map",
        segment: "world-maps",
        createBody: {
          name: "Old Town",
          scale: "settlement",
          description: "A market town",
          content: "Three roads meet at the well in the square.",
        },
        createIdField: "worldMapId",
        listField: "worldMaps",
        updateBody: { name: "Old Town Renamed" },
        updateField: "name",
        updateValue: "Old Town Renamed",
        statusTarget: "published",
        findPersisted: (id) => prisma.map.findUnique({ where: { id } }),
      },
      {
        label: "world element",
        segment: "world-elements",
        createBody: {
          name: "Mana Crystal",
          category: "artifact",
          description: "Glows faintly with stored magic",
          content: "Cut from the seam under the old quarry.",
        },
        createIdField: "worldElementId",
        listField: "worldElements",
        updateBody: { name: "Mana Crystal Renamed" },
        updateField: "name",
        updateValue: "Mana Crystal Renamed",
        statusTarget: "published",
        findPersisted: (id) => prisma.worldElement.findUnique({ where: { id } }),
      },
      {
        label: "faction",
        segment: "factions",
        createBody: {
          name: "Silver Hand",
          description: "A knightly order",
          background: "Founded after the war",
        },
        createIdField: "factionId",
        listField: "factions",
        updateBody: { name: "Silver Hand Renamed" },
        updateField: "name",
        updateValue: "Silver Hand Renamed",
        statusTarget: "active",
        findPersisted: (id) => prisma.faction.findUnique({ where: { id } }),
      },
      {
        label: "character",
        segment: "characters",
        createBody: {
          name: "Aria",
          archetype: "mentor",
          background: "Left the academy after the second siege",
          personality: "Patient, and slow to name her reasons",
          description: "A wandering sage",
        },
        createIdField: "characterId",
        listField: "characters",
        updateBody: { name: "Aria Renamed" },
        updateField: "name",
        updateValue: "Aria Renamed",
        statusTarget: "active",
        findPersisted: (id) => prisma.character.findUnique({ where: { id } }),
      },
      {
        label: "event",
        segment: "events",
        createBody: {
          title: "The Sundering",
          era: "First Age",
          eventType: "historical",
          description: "The night the sky split",
          content: "Two moons crossed and the horizon tore open.",
        },
        createIdField: "eventId",
        listField: "events",
        updateBody: { title: "The Sundering Renamed" },
        updateField: "title",
        updateValue: "The Sundering Renamed",
        statusTarget: "published",
        findPersisted: (id) => prisma.event.findUnique({ where: { id } }),
      },
      {
        label: "plot",
        segment: "plots",
        createBody: {
          name: "The Long Return",
          description: "A soldier walks home",
          theme: "belonging",
          content: "He walks north while the war keeps moving south.",
        },
        createIdField: "plotId",
        listField: "plots",
        updateBody: { name: "The Long Return Renamed" },
        updateField: "name",
        updateValue: "The Long Return Renamed",
        statusTarget: "active",
        findPersisted: (id) => prisma.plot.findUnique({ where: { id } }),
      },
      {
        // Stays in `outline` for the whole round trip — the only status where
        // ordinary edits are allowed (Flow 5). Transitions get their own test.
        label: "chapter",
        segment: "chapters",
        createBody: {
          title: "Chapter One",
          order: 1,
          summary: "The soldier sets out",
        },
        createIdField: "chapterId",
        listField: "chapters",
        updateBody: { title: "Chapter One Renamed" },
        updateField: "title",
        updateValue: "Chapter One Renamed",
        findPersisted: (id) => prisma.chapter.findUnique({ where: { id } }),
      },
    ];

    for (const entityCase of entityCases) {
      const createResponse = await request(`${basePath}/${entityCase.segment}`, {
        method: "POST",
        accessToken: session.accessToken,
        body: entityCase.createBody,
      });

      expect(createResponse.status, `${entityCase.label} create`).toBe(201);
      const createPayload = await readJson(createResponse);
      const entityId = (createPayload.data as JsonObject)[
        entityCase.createIdField
      ] as string;

      expect(entityId, `${entityCase.label} id`).toBeTruthy();

      const getResponse = await request(
        `${basePath}/${entityCase.segment}/${entityId}`,
        { accessToken: session.accessToken },
      );

      expect(getResponse.status, `${entityCase.label} get`).toBe(200);
      const getPayload = await readJson(getResponse);

      expect((getPayload.data as JsonObject).id, `${entityCase.label} get id`).toBe(
        entityId,
      );

      const listResponse = await request(`${basePath}/${entityCase.segment}`, {
        accessToken: session.accessToken,
      });

      expect(listResponse.status, `${entityCase.label} list`).toBe(200);
      const listPayload = await readJson(listResponse);
      const listItems = (listPayload.data as JsonObject)[
        entityCase.listField
      ] as JsonObject[];

      expect(
        listItems.some((item) => item.id === entityId),
        `${entityCase.label} list contains created id`,
      ).toBe(true);

      const updateResponse = await request(
        `${basePath}/${entityCase.segment}/${entityId}`,
        {
          method: "PATCH",
          accessToken: session.accessToken,
          body: entityCase.updateBody,
        },
      );

      expect(updateResponse.status, `${entityCase.label} update`).toBe(200);
      const updatePayload = await readJson(updateResponse);

      expect(
        (updatePayload.data as JsonObject)[entityCase.updateField],
        `${entityCase.label} updated field`,
      ).toBe(entityCase.updateValue);

      // Status changes are a separate endpoint from update for all nine content
      // entities, so a round trip that only exercises PATCH .../:id leaves the
      // whole `changeXStatus` path — body schema, toChangeXStatusInput, the
      // service call — unproven over HTTP. It was: before this leg, the only
      // `/status` requests anywhere in test/ were Chapter's and Scene's, which
      // means the five Phase 4 entities had carried an untested endpoint since
      // 4.6.
      if (entityCase.statusTarget) {
        const statusResponse = await request(
          `${basePath}/${entityCase.segment}/${entityId}/status`,
          {
            method: "PATCH",
            accessToken: session.accessToken,
            body: { status: entityCase.statusTarget },
          },
        );

        expect(statusResponse.status, `${entityCase.label} change status`).toBe(
          200,
        );

        const statusPayload = await readJson(statusResponse);

        expect(
          (statusPayload.data as JsonObject).status,
          `${entityCase.label} status after change`,
        ).toBe(entityCase.statusTarget);
      }

      const deleteResponse = await request(
        `${basePath}/${entityCase.segment}/${entityId}`,
        { method: "DELETE", accessToken: session.accessToken },
      );

      expect(deleteResponse.status, `${entityCase.label} delete`).toBe(200);

      const persisted = await entityCase.findPersisted(entityId);

      expect(persisted, `${entityCase.label} persisted after delete`).toBeNull();
    }
  });

  it("rejects a child layer whose level is not greater than its parent's level", async () => {
    const session = await registerAndLogin("layer-level-guard");
    const projectId = await createProject(
      session.accessToken,
      "Layer Level Guard Project",
    );
    const parentId = await createLayer(session.accessToken, projectId, {
      name: "Parent Layer",
      level: 3,
      exposure: "reader_visible",
    });

    const response = await request(`/api/v1/projects/${projectId}/layers`, {
      method: "POST",
      accessToken: session.accessToken,
      body: { parentId, name: "Child Layer", level: 3, exposure: "reader_visible" },
    });

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Layer level must be greater than its parent's level",
      },
    });
  });

  it("rejects a layer whose parentId belongs to a different project", async () => {
    const ownerSession = await registerAndLogin("layer-cross-project-owner");
    const projectA = await createProject(
      ownerSession.accessToken,
      "Layer Cross Project A",
    );
    const parentId = await createLayer(ownerSession.accessToken, projectA, {
      name: "Parent In Project A",
      level: 1,
      exposure: "reader_visible",
    });

    const outsiderSession = await registerAndLogin("layer-cross-project-outsider");
    const projectB = await createProject(
      outsiderSession.accessToken,
      "Layer Cross Project B",
    );

    const response = await request(`/api/v1/projects/${projectB}/layers`, {
      method: "POST",
      accessToken: outsiderSession.accessToken,
      body: {
        parentId,
        name: "Child In Project B",
        level: 2,
        exposure: "reader_visible",
      },
    });

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "NOT_FOUND", message: "Parent layer not found" },
    });
  });

  it("rejects deleting a layer that still has a child, then allows it once the child is gone", async () => {
    const session = await registerAndLogin("layer-delete-guard");
    const projectId = await createProject(
      session.accessToken,
      "Layer Delete Guard Project",
    );
    const parentId = await createLayer(session.accessToken, projectId, {
      name: "Parent Layer",
      level: 1,
      exposure: "reader_visible",
    });
    const childId = await createLayer(session.accessToken, projectId, {
      parentId,
      name: "Child Layer",
      level: 2,
      exposure: "reader_visible",
    });

    const blockedResponse = await request(
      `/api/v1/projects/${projectId}/layers/${parentId}`,
      { method: "DELETE", accessToken: session.accessToken },
    );

    expect(blockedResponse.status).toBe(409);
    await expect(readJson(blockedResponse)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Layer is still referenced and cannot be deleted",
      },
    });

    const deleteChildResponse = await request(
      `/api/v1/projects/${projectId}/layers/${childId}`,
      { method: "DELETE", accessToken: session.accessToken },
    );

    expect(deleteChildResponse.status).toBe(200);

    const deleteParentResponse = await request(
      `/api/v1/projects/${projectId}/layers/${parentId}`,
      { method: "DELETE", accessToken: session.accessToken },
    );

    expect(deleteParentResponse.status).toBe(200);
  });

  // Flow 5 end to end through the single /status endpoint. The point of walking
  // the whole machine rather than spot-checking one edge: `review -> draft` and
  // `published -> draft` are two DIFFERENT transitions that land on the same
  // target, so only a run that reaches draft from both sides proves the endpoint
  // resolves the (origin, target) PAIR instead of just the target.
  it("walks a chapter through every Flow 5 transition and rejects invalid ones", async () => {
    const session = await registerAndLogin("chapter-lifecycle");
    const projectId = await createProject(
      session.accessToken,
      "Chapter Lifecycle Project",
    );
    const chapterId = await createChapter(session.accessToken, projectId, {
      title: "Chapter One",
      order: 1,
      summary: "The soldier sets out",
    });
    const chapterPath = `/api/v1/projects/${projectId}/chapters/${chapterId}`;

    const toDraft = await changeChapterStatus(
      session.accessToken,
      chapterPath,
      "draft",
    );

    expect(toDraft.status).toBe(200);
    expect((await readJson(toDraft)).data).toMatchObject({
      status: "draft",
      publishedAt: null,
    });

    // Skipping an edge: draft -> published is not in the table at all.
    const skipEdge = await changeChapterStatus(
      session.accessToken,
      chapterPath,
      "published",
    );

    expect(skipEdge.status).toBe(400);
    await expect(readJson(skipEdge)).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Cannot transition chapter from draft to published",
      },
    });

    // draft -> review needs content; the chapter has none yet.
    const missingContent = await changeChapterStatus(
      session.accessToken,
      chapterPath,
      "review",
    );

    expect(missingContent.status).toBe(400);
    await expect(readJson(missingContent)).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Chapter content is required before submitting for review",
      },
    });

    const addContent = await request(chapterPath, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { content: "He left before the gate bell rang." },
    });

    expect(addContent.status).toBe(200);

    const toReview = await changeChapterStatus(
      session.accessToken,
      chapterPath,
      "review",
    );

    expect(toReview.status).toBe(200);
    expect((await readJson(toReview)).data).toMatchObject({ status: "review" });

    // "Semua editing terjadi di draft" — enforced by the entity, surfaced as 400.
    const editInReview = await request(chapterPath, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { title: "Renamed While Under Review" },
    });

    expect(editInReview.status).toBe(400);
    await expect(readJson(editInReview)).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message:
          "Chapter cannot be edited while status is review; transition back to draft first",
      },
    });

    // First of the two edges that land on draft: revision request.
    const backFromReview = await changeChapterStatus(
      session.accessToken,
      chapterPath,
      "draft",
    );

    expect(backFromReview.status).toBe(200);
    expect((await readJson(backFromReview)).data).toMatchObject({
      status: "draft",
      publishedAt: null,
    });

    expect(
      (await changeChapterStatus(session.accessToken, chapterPath, "review"))
        .status,
    ).toBe(200);

    const published = await changeChapterStatus(
      session.accessToken,
      chapterPath,
      "published",
    );

    expect(published.status).toBe(200);
    const publishedData = (await readJson(published)).data as JsonObject;

    expect(publishedData.status).toBe("published");
    expect(publishedData.publishedAt).not.toBeNull();

    // Second edge landing on draft: unpublish, which also clears publishedAt.
    const unpublished = await changeChapterStatus(
      session.accessToken,
      chapterPath,
      "draft",
    );

    expect(unpublished.status).toBe(200);
    expect((await readJson(unpublished)).data).toMatchObject({
      status: "draft",
      publishedAt: null,
    });
  });

  it("rejects a chapter that reuses an order already taken in the project", async () => {
    const session = await registerAndLogin("chapter-order-conflict");
    const projectId = await createProject(
      session.accessToken,
      "Chapter Order Conflict Project",
    );

    await createChapter(session.accessToken, projectId, {
      title: "Chapter One",
      order: 1,
    });

    const response = await request(`/api/v1/projects/${projectId}/chapters`, {
      method: "POST",
      accessToken: session.accessToken,
      body: { title: "Also Chapter One", order: 1 },
    });

    // 409, not 400: the request is well-formed, the position is simply taken.
    // Distinct from the generic version conflict — retrying this unchanged can
    // never succeed, so the message names the fix.
    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Another chapter in this project already uses that order",
      },
    });
  });

  it("round-trips a scene through its nested collection and flat item endpoints", async () => {
    const session = await registerAndLogin("scene-crud");
    const projectId = await createProject(session.accessToken, "Scene CRUD Project");
    const chapterId = await createChapter(session.accessToken, projectId, {
      title: "Chapter One",
      order: 1,
      summary: "The soldier sets out",
    });
    const basePath = `/api/v1/projects/${projectId}`;

    const createResponse = await request(
      `${basePath}/chapters/${chapterId}/scenes`,
      {
        method: "POST",
        accessToken: session.accessToken,
        body: {
          orderInChapter: 0,
          title: "At the gate",
          content: "The bell had not rung yet.",
        },
      },
    );

    expect(createResponse.status).toBe(201);
    const sceneId = (await readJson(createResponse)).data as JsonObject;
    const id = sceneId.sceneId as string;

    expect(id).toBeTruthy();

    const listResponse = await request(
      `${basePath}/chapters/${chapterId}/scenes`,
      { accessToken: session.accessToken },
    );

    expect(listResponse.status).toBe(200);
    const scenes = (await readJson(listResponse)).data as JsonObject;

    expect((scenes.scenes as JsonObject[]).map((s) => s.id)).toContain(id);

    const getResponse = await request(`${basePath}/scenes/${id}`, {
      accessToken: session.accessToken,
    });

    expect(getResponse.status).toBe(200);
    expect((await readJson(getResponse)).data).toMatchObject({
      id,
      chapterId,
      title: "At the gate",
    });

    const updateResponse = await request(`${basePath}/scenes/${id}`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { title: "At the gate, renamed" },
    });

    expect(updateResponse.status).toBe(200);
    expect((await readJson(updateResponse)).data).toMatchObject({
      title: "At the gate, renamed",
    });

    const statusResponse = await request(`${basePath}/scenes/${id}/status`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { status: "published" },
    });

    expect(statusResponse.status).toBe(200);
    expect((await readJson(statusResponse)).data).toMatchObject({
      status: "published",
    });

    const deleteResponse = await request(`${basePath}/scenes/${id}`, {
      method: "DELETE",
      accessToken: session.accessToken,
    });

    expect(deleteResponse.status).toBe(200);
    await expect(
      prisma.scene.findUnique({ where: { id } }),
    ).resolves.toBeNull();
  });

  it("refuses to hang a scene off a chapter that belongs to a different project", async () => {
    const ownerSession = await registerAndLogin("scene-cross-project-owner");
    const projectA = await createProject(
      ownerSession.accessToken,
      "Scene Cross Project A",
    );
    const chapterId = await createChapter(ownerSession.accessToken, projectA, {
      title: "Chapter In Project A",
      order: 1,
    });

    const outsiderSession = await registerAndLogin("scene-cross-project-outsider");
    const projectB = await createProject(
      outsiderSession.accessToken,
      "Scene Cross Project B",
    );

    // `scenes.chapter_id` is a plain FK, so the database alone would accept
    // this write — the same cross-tenant hole found in Layer/WorldMap in
    // Phase 4. Only SceneService's parent pre-check stops it.
    const createResponse = await request(
      `/api/v1/projects/${projectB}/chapters/${chapterId}/scenes`,
      {
        method: "POST",
        accessToken: outsiderSession.accessToken,
        body: { orderInChapter: 0, title: "Smuggled scene" },
      },
    );

    expect(createResponse.status).toBe(404);
    await expect(readJson(createResponse)).resolves.toMatchObject({
      error: { code: "NOT_FOUND", message: "Chapter not found" },
    });

    // The nested list is scoped the same way, and answers 404 rather than an
    // empty array: "no such chapter here" is not "this chapter has no scenes".
    const listResponse = await request(
      `/api/v1/projects/${projectB}/chapters/${chapterId}/scenes`,
      { accessToken: outsiderSession.accessToken },
    );

    expect(listResponse.status).toBe(404);
    await expect(readJson(listResponse)).resolves.toMatchObject({
      error: { code: "NOT_FOUND", message: "Chapter not found" },
    });
  });

  it("rejects a second scene that reuses an order already taken in the chapter", async () => {
    const session = await registerAndLogin("scene-order-conflict");
    const projectId = await createProject(
      session.accessToken,
      "Scene Order Conflict Project",
    );
    const chapterId = await createChapter(session.accessToken, projectId, {
      title: "Chapter One",
      order: 1,
    });
    const scenesPath = `/api/v1/projects/${projectId}/chapters/${chapterId}/scenes`;

    const first = await request(scenesPath, {
      method: "POST",
      accessToken: session.accessToken,
      body: { orderInChapter: 0, title: "First" },
    });

    expect(first.status).toBe(201);

    const second = await request(scenesPath, {
      method: "POST",
      accessToken: session.accessToken,
      body: { orderInChapter: 0, title: "Also first" },
    });

    // The Chapter twin of this case was already covered; this one closes the
    // other half of the pair. Same 409-not-400 reasoning: the request is
    // well-formed and the position is simply taken, so retrying it unchanged
    // can never succeed — the message has to name the fix, and the repository
    // must have told the service `SceneRepositoryOrderConflictError` rather
    // than the generic version conflict, whose advice ("reload and retry")
    // would be wrong here.
    expect(second.status).toBe(409);
    await expect(readJson(second)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Another scene in this chapter already uses that order",
      },
    });

    // Sanity: the same order IS free in a different chapter, so the constraint
    // really is (chapter_id, order_in_chapter) and not project-wide.
    const otherChapterId = await createChapter(session.accessToken, projectId, {
      title: "Chapter Two",
      order: 2,
    });
    const otherChapterScene = await request(
      `/api/v1/projects/${projectId}/chapters/${otherChapterId}/scenes`,
      {
        method: "POST",
        accessToken: session.accessToken,
        body: { orderInChapter: 0, title: "First of chapter two" },
      },
    );

    expect(otherChapterScene.status).toBe(201);
  });

  // The role matrix is already exhausted in the four service unit-test files.
  // What CANNOT be proven there is that the Controller actually forwards the
  // membership it read from the request context — a controller that passed a
  // hardcoded `{ role: "writer", canDelete: true }` would keep every one of
  // those unit tests green. Hence one representative denial per entity here,
  // over real HTTP, rather than a full matrix duplicated at this level.
  it("enforces role and canDelete at the HTTP boundary for every timeline+story entity", async () => {
    const owner = await registerAndLogin("matrix-owner");
    const projectId = await createProject(owner.accessToken, "Role Matrix Project");
    const reviewer = await registerAndLogin("matrix-reviewer");
    const editorNoDelete = await registerAndLogin("matrix-editor-plain");
    const editorCanDelete = await registerAndLogin("matrix-editor-deleter");

    await seedMembership(projectId, reviewer.userId, "reviewer", false);
    await seedMembership(projectId, editorNoDelete.userId, "editor", false);
    await seedMembership(projectId, editorCanDelete.userId, "editor", true);

    const basePath = `/api/v1/projects/${projectId}`;
    // Parent for the scene case; kept out of the delete cases below by using an
    // order no other chapter in this test claims.
    const parentChapterId = await createChapter(owner.accessToken, projectId, {
      title: "Parent Chapter",
      order: 99,
      summary: "Holds the scene used by the matrix",
    });

    const matrixCases = [
      {
        label: "event",
        createPath: `${basePath}/events`,
        createBody: { title: "Matrix Event" },
        idField: "eventId",
        itemPath: (id: string) => `${basePath}/events/${id}`,
      },
      {
        label: "plot",
        createPath: `${basePath}/plots`,
        createBody: { name: "Matrix Plot" },
        idField: "plotId",
        itemPath: (id: string) => `${basePath}/plots/${id}`,
      },
      {
        label: "chapter",
        createPath: `${basePath}/chapters`,
        createBody: { title: "Matrix Chapter", order: 1 },
        idField: "chapterId",
        itemPath: (id: string) => `${basePath}/chapters/${id}`,
      },
      {
        label: "scene",
        createPath: `${basePath}/chapters/${parentChapterId}/scenes`,
        createBody: { orderInChapter: 0, title: "Matrix Scene" },
        idField: "sceneId",
        itemPath: (id: string) => `${basePath}/scenes/${id}`,
      },
    ];

    for (const matrixCase of matrixCases) {
      const created = await request(matrixCase.createPath, {
        method: "POST",
        accessToken: owner.accessToken,
        body: matrixCase.createBody,
      });

      expect(created.status, `${matrixCase.label} created by owner`).toBe(201);
      const entityId = ((await readJson(created)).data as JsonObject)[
        matrixCase.idField
      ] as string;

      // Reviewer is a genuine member, so this is 403 from the service's own
      // authorization, not 404 from the membership middleware. For scene it
      // also pins the ORDER of the checks: authorization runs before the parent
      // chapter is loaded, so a reviewer never learns whether the chapter in
      // the URL exists.
      const reviewerCreate = await request(matrixCase.createPath, {
        method: "POST",
        accessToken: reviewer.accessToken,
        body: matrixCase.createBody,
      });

      expect(
        reviewerCreate.status,
        `${matrixCase.label} create as reviewer`,
      ).toBe(403);

      const blockedDelete = await request(matrixCase.itemPath(entityId), {
        method: "DELETE",
        accessToken: editorNoDelete.accessToken,
      });

      expect(
        blockedDelete.status,
        `${matrixCase.label} delete as editor without canDelete`,
      ).toBe(403);

      // The positive half matters as much as the denials: without it, a
      // controller that rejected every delete would pass just as happily, and
      // `canDelete` would look enforced while actually being ignored.
      const allowedDelete = await request(matrixCase.itemPath(entityId), {
        method: "DELETE",
        accessToken: editorCanDelete.accessToken,
      });

      expect(
        allowedDelete.status,
        `${matrixCase.label} delete as editor with canDelete`,
      ).toBe(200);
    }

    // Proves the ordering claimed above instead of merely asserting it: the
    // chapter in this URL does not exist, so a service that loaded the parent
    // before checking authorization would answer 404. 403 means a reviewer is
    // turned away before anything is read — no probing for which chapter ids
    // are real.
    const reviewerUnknownChapter = await request(
      `${basePath}/chapters/${crypto.randomUUID()}/scenes`,
      {
        method: "POST",
        accessToken: reviewer.accessToken,
        body: { orderInChapter: 0, title: "Never created" },
      },
    );

    expect(reviewerUnknownChapter.status).toBe(403);
  });

  it("refuses to delete a chapter that still has scenes, then allows it once the scene is gone", async () => {
    const session = await registerAndLogin("chapter-delete-guard");
    const projectId = await createProject(
      session.accessToken,
      "Chapter Delete Guard Project",
    );
    const chapterId = await createChapter(session.accessToken, projectId, {
      title: "Chapter One",
      order: 1,
    });
    const basePath = `/api/v1/projects/${projectId}`;

    const createSceneResponse = await request(
      `${basePath}/chapters/${chapterId}/scenes`,
      {
        method: "POST",
        accessToken: session.accessToken,
        body: { orderInChapter: 0, title: "Only scene" },
      },
    );

    expect(createSceneResponse.status).toBe(201);
    const sceneId = ((await readJson(createSceneResponse)).data as JsonObject)
      .sceneId as string;

    // Deliberately not cascaded: scenes carry their own revisions and Qdrant
    // points, so deleting them silently would skip both.
    const blockedResponse = await request(`${basePath}/chapters/${chapterId}`, {
      method: "DELETE",
      accessToken: session.accessToken,
    });

    expect(blockedResponse.status).toBe(409);
    await expect(readJson(blockedResponse)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Chapter still has scenes and cannot be deleted",
      },
    });

    const deleteSceneResponse = await request(`${basePath}/scenes/${sceneId}`, {
      method: "DELETE",
      accessToken: session.accessToken,
    });

    expect(deleteSceneResponse.status).toBe(200);

    const deleteChapterResponse = await request(
      `${basePath}/chapters/${chapterId}`,
      { method: "DELETE", accessToken: session.accessToken },
    );

    expect(deleteChapterResponse.status).toBe(200);
  });
});
