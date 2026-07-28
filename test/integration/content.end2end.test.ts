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

type EntityCase = {
  label: string;
  segment: string;
  createBody: JsonObject;
  createIdField: string;
  listField: string;
  updateBody: JsonObject;
  updateField: string;
  updateValue: unknown;
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
        },
        createIdField: "layerId",
        listField: "layers",
        updateBody: { name: "Updated Ground Floor" },
        updateField: "name",
        updateValue: "Updated Ground Floor",
        findPersisted: (id) => prisma.layer.findUnique({ where: { id } }),
      },
      {
        label: "world map",
        segment: "world-maps",
        createBody: { name: "Old Town", scale: "settlement", description: "A market town" },
        createIdField: "worldMapId",
        listField: "worldMaps",
        updateBody: { name: "Old Town Renamed" },
        updateField: "name",
        updateValue: "Old Town Renamed",
        findPersisted: (id) => prisma.map.findUnique({ where: { id } }),
      },
      {
        label: "world element",
        segment: "world-elements",
        createBody: {
          name: "Mana Crystal",
          category: "artifact",
          description: "Glows faintly with stored magic",
        },
        createIdField: "worldElementId",
        listField: "worldElements",
        updateBody: { name: "Mana Crystal Renamed" },
        updateField: "name",
        updateValue: "Mana Crystal Renamed",
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
        findPersisted: (id) => prisma.faction.findUnique({ where: { id } }),
      },
      {
        label: "character",
        segment: "characters",
        createBody: {
          name: "Aria",
          archetype: "mentor",
          description: "A wandering sage",
        },
        createIdField: "characterId",
        listField: "characters",
        updateBody: { name: "Aria Renamed" },
        updateField: "name",
        updateValue: "Aria Renamed",
        findPersisted: (id) => prisma.character.findUnique({ where: { id } }),
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
});
