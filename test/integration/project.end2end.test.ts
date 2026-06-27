import { once } from "node:events";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createAppContainer } from "../../src/infrastructure/container.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const EMAIL_SUFFIX = "@project-e2e.test";
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
    rawBody?: string;
    accessToken?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers({
    "x-request-id": `e2e-${crypto.randomUUID()}`,
  });

  if (options.body !== undefined || options.rawBody !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (options.accessToken) {
    headers.set("authorization", `Bearer ${options.accessToken}`);
  }

  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.rawBody ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
}

async function readJson(response: Response): Promise<JsonObject> {
  return response.json() as Promise<JsonObject>;
}

async function register(name: string): Promise<void> {
  const response = await request("/api/v1/auth/register", {
    method: "POST",
    body: {
      email: emailFor(name),
      password: PASSWORD,
      confirmPassword: PASSWORD,
      username: name,
      displayName: `Writer ${name}`,
    },
  });

  expect(response.status).toBe(201);
}

async function login(name: string): Promise<{
  accessToken: string;
  userId: string;
}> {
  const response = await request("/api/v1/auth/login", {
    method: "POST",
    body: {
      email: emailFor(name),
      password: PASSWORD,
    },
  });
  const payload = await readJson(response);

  expect(response.status).toBe(200);

  const data = payload.data as JsonObject;

  return {
    accessToken: data.accessToken as string,
    userId: (data.user as JsonObject).id as string,
  };
}

async function registerAndLogin(
  name: string,
): Promise<{ accessToken: string; userId: string }> {
  await register(name);
  return login(name);
}

async function createProject(
  accessToken: string,
  name: string,
  options: { description?: string; genre?: string; tone?: string } = {},
): Promise<string> {
  const response = await request("/api/v1/projects", {
    method: "POST",
    accessToken,
    body: { name, ...options },
  });

  expect(response.status).toBe(201);
  const payload = await readJson(response);

  return (payload.data as JsonObject).projectId as string;
}

async function seedSecondMembership(
  projectId: string,
  userId: string,
  role: "writer" | "editor" | "reviewer" = "writer",
): Promise<void> {
  await prisma.userProject.create({
    data: {
      id: crypto.randomUUID(),
      projectId,
      userId,
      role,
      canDelete: false,
      aiAccess: "full",
      status: "active",
      joinedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  process.env.JWT_SECRET = "project-e2e-test-secret";

  const container = createAppContainer();
  const app = createApp(container);
  prisma = container.resolve("prisma");
  server = serve({ fetch: app.fetch, port: 0 });

  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Project E2E server did not expose a TCP port");
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

describe("Project end-to-end", () => {
  it("creates a project atomically with a writer membership for the creator", async () => {
    const session = await registerAndLogin("create-owner");

    const projectId = await createProject(session.accessToken, "My Novel", {
      description: "A fantasy story",
      genre: "Fantasy",
    });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    expect(project).toMatchObject({
      name: "My Novel",
      description: "A fantasy story",
      genre: "Fantasy",
      status: "draft",
      visibility: "private",
      ownerUserId: session.userId,
      createdByUserId: session.userId,
      archivedAt: null,
    });

    const membership = await prisma.userProject.findFirst({
      where: { projectId, userId: session.userId },
    });

    expect(membership).toMatchObject({
      role: "writer",
      canDelete: true,
      aiAccess: "full",
      status: "active",
      invitedByUserId: null,
    });
  });

  it("maps malformed and invalid create project bodies to validation errors", async () => {
    const session = await registerAndLogin("create-validation");

    const malformedResponse = await request("/api/v1/projects", {
      method: "POST",
      accessToken: session.accessToken,
      rawBody: "{",
    });
    const invalidResponse = await request("/api/v1/projects", {
      method: "POST",
      accessToken: session.accessToken,
      body: { name: "" },
    });
    const unknownFieldResponse = await request("/api/v1/projects", {
      method: "POST",
      accessToken: session.accessToken,
      body: { name: "Valid", unexpected: "field" },
    });

    expect(malformedResponse.status).toBe(400);
    await expect(readJson(malformedResponse)).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "Malformed JSON body" },
    });

    expect(invalidResponse.status).toBe(400);
    await expect(readJson(invalidResponse)).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: expect.arrayContaining([
          expect.objectContaining({ field: "name" }),
        ]),
      },
    });

    expect(unknownFieldResponse.status).toBe(400);
  });

  it("rejects updating project details with an empty name", async () => {
    const session = await registerAndLogin("update-empty-name-owner");
    const projectId = await createProject(session.accessToken, "Empty Name Novel");

    const response = await request(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { name: "" },
    });

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: expect.arrayContaining([
          expect.objectContaining({ field: "name" }),
        ]),
      },
    });

    const persisted = await prisma.project.findUnique({
      where: { id: projectId },
    });

    expect(persisted?.name).toBe("Empty Name Novel");
  });

  it("retrieves a project with the full response shape and no internal leaks", async () => {
    const session = await registerAndLogin("get-owner");
    const projectId = await createProject(session.accessToken, "Get Novel");

    const response = await request(`/api/v1/projects/${projectId}`, {
      accessToken: session.accessToken,
    });

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    const data = payload.data as JsonObject;

    expect(data).toMatchObject({
      id: projectId,
      name: "Get Novel",
      ownerUserId: session.userId,
      createdByUserId: session.userId,
      visibility: "private",
      status: "draft",
      description: null,
      genre: null,
      tone: null,
      style: null,
      language: null,
      archivedAt: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const expectedKeys = [
      "id",
      "ownerUserId",
      "createdByUserId",
      "name",
      "description",
      "genre",
      "tone",
      "style",
      "language",
      "visibility",
      "status",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ];
    expect(Object.keys(data).sort()).toEqual([...expectedKeys].sort());
  });

  it("updates project details and clears optional fields with null", async () => {
    const session = await registerAndLogin("update-owner");
    const projectId = await createProject(session.accessToken, "Update Novel", {
      description: "Original description",
      genre: "Fantasy",
    });

    const response = await request(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: {
        name: "Updated Novel",
        description: null,
        genre: "Sci-Fi",
      },
    });

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect((payload.data as JsonObject).name).toBe("Updated Novel");
    expect((payload.data as JsonObject).description).toBeNull();
    expect((payload.data as JsonObject).genre).toBe("Sci-Fi");

    const persisted = await prisma.project.findUnique({
      where: { id: projectId },
    });

    expect(persisted?.name).toBe("Updated Novel");
    expect(persisted?.description).toBeNull();
    expect(persisted?.genre).toBe("Sci-Fi");
  });

  it("activates a draft project", async () => {
    const session = await registerAndLogin("activate-owner");
    const projectId = await createProject(session.accessToken, "Activate Novel");

    const response = await request(`/api/v1/projects/${projectId}/activate`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    expect(response.status).toBe(200);

    const persisted = await prisma.project.findUnique({
      where: { id: projectId },
    });

    expect(persisted?.status).toBe("active");
  });

  it("archives an active project and sets archivedAt", async () => {
    const session = await registerAndLogin("archive-owner");
    const projectId = await createProject(session.accessToken, "Archive Novel");

    await request(`/api/v1/projects/${projectId}/activate`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    const response = await request(`/api/v1/projects/${projectId}/archive`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    expect(response.status).toBe(200);

    const persisted = await prisma.project.findUnique({
      where: { id: projectId },
    });

    expect(persisted?.status).toBe("archived");
    expect(persisted?.archivedAt).toBeInstanceOf(Date);
  });

  it("rejects archiving an already-archived project with 409", async () => {
    const session = await registerAndLogin("archive-conflict-owner");
    const projectId = await createProject(session.accessToken, "Archive Conflict Novel");

    await request(`/api/v1/projects/${projectId}/archive`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    const response = await request(`/api/v1/projects/${projectId}/archive`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Operation is not allowed on an archived project.",
      },
    });
  });

  it("rejects updating an archived project with 409", async () => {
    const session = await registerAndLogin("update-archived-owner");
    const projectId = await createProject(session.accessToken, "Update Archived Novel");

    await request(`/api/v1/projects/${projectId}/archive`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    const response = await request(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { name: "New Name" },
    });

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Operation is not allowed on an archived project.",
      },
    });
  });

  it("rejects activating an archived project with 409", async () => {
    const session = await registerAndLogin("activate-archived-owner");
    const projectId = await createProject(session.accessToken, "Activate Archived Novel");

    await request(`/api/v1/projects/${projectId}/archive`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    const response = await request(`/api/v1/projects/${projectId}/activate`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Operation is not allowed on an archived project.",
      },
    });
  });

  it("rejects changing visibility of an archived project with 409", async () => {
    const session = await registerAndLogin("visibility-archived-owner");
    const projectId = await createProject(session.accessToken, "Visibility Archived Novel");

    await request(`/api/v1/projects/${projectId}/archive`, {
      method: "PATCH",
      accessToken: session.accessToken,
    });

    const response = await request(`/api/v1/projects/${projectId}/visibility`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { visibility: "shared" },
    });

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Operation is not allowed on an archived project.",
      },
    });
  });

  it("changes project visibility", async () => {
    const session = await registerAndLogin("visibility-owner");
    const projectId = await createProject(session.accessToken, "Visibility Novel");

    const response = await request(`/api/v1/projects/${projectId}/visibility`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { visibility: "shared" },
    });

    expect(response.status).toBe(200);

    const persisted = await prisma.project.findUnique({
      where: { id: projectId },
    });

    expect(persisted?.visibility).toBe("shared");
  });

  it("lists project members with the creator as writer", async () => {
    const session = await registerAndLogin("list-members-owner");
    const projectId = await createProject(session.accessToken, "Members Novel");

    const response = await request(`/api/v1/projects/${projectId}/members`, {
      accessToken: session.accessToken,
    });

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    const members = (payload.data as JsonObject).members as JsonObject[];

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      userId: session.userId,
      role: "writer",
      canDelete: true,
      aiAccess: "full",
      invitedByUserId: null,
    });

    const expectedKeys = [
      "id",
      "userId",
      "role",
      "canDelete",
      "aiAccess",
      "joinedAt",
      "invitedByUserId",
    ];
    expect(Object.keys(members[0]).sort()).toEqual([...expectedKeys].sort());
  });

  it("changes a non-writer member role and persists it", async () => {
    const ownerSession = await registerAndLogin("role-owner");
    const memberSession = await registerAndLogin("role-member");
    const projectId = await createProject(ownerSession.accessToken, "Role Novel");

    await seedSecondMembership(projectId, memberSession.userId, "editor");

    const response = await request(
      `/api/v1/projects/${projectId}/members/${memberSession.userId}`,
      {
        method: "PATCH",
        accessToken: ownerSession.accessToken,
        body: { role: "reviewer" },
      },
    );

    expect(response.status).toBe(200);

    const persisted = await prisma.userProject.findFirst({
      where: { projectId, userId: memberSession.userId },
    });

    expect(persisted?.role).toBe("reviewer");
  });

  it("rejects removing the last writer from a project", async () => {
    const session = await registerAndLogin("last-writer-owner");
    const projectId = await createProject(session.accessToken, "Last Writer Novel");

    const response = await request(
      `/api/v1/projects/${projectId}/members/${session.userId}`,
      {
        method: "PATCH",
        accessToken: session.accessToken,
        body: { role: "editor" },
      },
    );

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
        message: "Cannot remove the last writer from project",
      },
    });

    const persisted = await prisma.userProject.findFirst({
      where: { projectId, userId: session.userId },
    });

    expect(persisted?.role).toBe("writer");
  });

  it("rejects unauthenticated project requests", async () => {
    const session = await registerAndLogin("auth-owner");
    const projectId = await createProject(session.accessToken, "Auth Novel");

    const missingCreate = await request("/api/v1/projects", {
      method: "POST",
      body: { name: "No Auth" },
    });
    const invalidCreate = await request("/api/v1/projects", {
      method: "POST",
      accessToken: "invalid-token",
      body: { name: "Bad Auth" },
    });
    const missingGet = await request(`/api/v1/projects/${projectId}`);
    const invalidGet = await request(`/api/v1/projects/${projectId}`, {
      accessToken: "invalid-token",
    });

    for (const response of [missingCreate, invalidCreate, missingGet, invalidGet]) {
      expect(response.status).toBe(401);
      await expect(readJson(response)).resolves.toMatchObject({
        error: { code: "UNAUTHORIZED" },
      });
    }
  });

  it("hides project existence from non-members", async () => {
    const ownerSession = await registerAndLogin("hide-owner");
    const outsiderSession = await registerAndLogin("hide-outsider");
    const projectId = await createProject(ownerSession.accessToken, "Hidden Novel");

    const response = await request(`/api/v1/projects/${projectId}`, {
      accessToken: outsiderSession.accessToken,
    });

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Project not found",
      },
    });
  });

  it("returns 404 for a non-existent project", async () => {
    const session = await registerAndLogin("not-found-owner");
    const randomProjectId = crypto.randomUUID();

    const response = await request(`/api/v1/projects/${randomProjectId}`, {
      accessToken: session.accessToken,
    });

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "NOT_FOUND", message: "Project not found" },
    });
  });

  it("rejects member role change on a non-existent membership", async () => {
    const session = await registerAndLogin("no-member-owner");
    const projectId = await createProject(session.accessToken, "No Member Novel");
    const outsiderSession = await registerAndLogin("no-member-outsider");

    const response = await request(
      `/api/v1/projects/${projectId}/members/${outsiderSession.userId}`,
      {
        method: "PATCH",
        accessToken: session.accessToken,
        body: { role: "editor" },
      },
    );

    expect(response.status).toBe(404);
    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "NOT_FOUND", message: "Project membership not found" },
    });
  });

  it("rejects trailing slashes on strict project routes", async () => {
    const session = await registerAndLogin("strict-owner");
    const projectId = await createProject(session.accessToken, "Strict Novel");

    const response = await request(`/api/v1/projects/${projectId}/`, {
      accessToken: session.accessToken,
    });

    expect(response.status).toBe(404);
  });
});
