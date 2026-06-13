import { once } from "node:events";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createAppContainer } from "../../src/infrastructure/container.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const EMAIL_SUFFIX = "@auth-e2e.test";
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

async function register(name: string): Promise<JsonObject> {
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

  return readJson(response);
}

async function login(name: string): Promise<{
  accessToken: string;
  refreshToken: string;
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
  expect(payload).toMatchObject({
    data: {
      user: {
        email: emailFor(name),
        username: name,
      },
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    },
  });

  const data = payload.data as JsonObject;

  return {
    accessToken: data.accessToken as string,
    refreshToken: data.refreshToken as string,
  };
}

async function registerAndLogin(name: string) {
  await register(name);
  return login(name);
}

beforeAll(async () => {
  process.env.JWT_SECRET = "auth-error2error-test-secret";

  const container = createAppContainer();
  const app = createApp(container);
  prisma = container.resolve("prisma");
  server = serve({ fetch: app.fetch, port: 0 });

  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Auth E2E server did not expose a TCP port");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await prisma.user.deleteMany({
    where: {
      email: { endsWith: EMAIL_SUFFIX },
    },
  });
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

describe("Auth end-to-end", () => {
  it("registers through the public domain mount without exposing secrets", async () => {
    const payload = await register("register-user");

    expect(payload).toMatchObject({
      data: {
        user: {
          id: expect.any(String),
          email: emailFor("register-user"),
          username: "register-user",
          displayName: "Writer register-user",
        },
      },
      meta: { requestId: expect.any(String) },
    });
    expect((payload.data as JsonObject).passwordHash).toBeUndefined();

    const persistedUser = await prisma.user.findUnique({
      where: { email: emailFor("register-user") },
    });

    expect(persistedUser?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(persistedUser?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("maps malformed and invalid register bodies to validation errors", async () => {
    const malformedResponse = await request("/api/v1/auth/register", {
      method: "POST",
      rawBody: "{",
    });
    const invalidResponse = await request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "invalid-email",
        password: "weak",
        confirmPassword: "different",
      },
    });

    expect(malformedResponse.status).toBe(400);
    await expect(readJson(malformedResponse)).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Malformed JSON body",
      },
    });
    expect(invalidResponse.status).toBe(400);
    await expect(readJson(invalidResponse)).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: expect.arrayContaining([
          expect.objectContaining({ field: "email" }),
          expect.objectContaining({ field: "password" }),
          expect.objectContaining({ field: "confirmPassword" }),
        ]),
      },
    });
  });

  it("rejects duplicate email registration case-insensitively", async () => {
    await register("duplicate-user");

    const response = await request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: emailFor("duplicate-user").toUpperCase(),
        password: PASSWORD,
        confirmPassword: PASSWORD,
        username: "other-user",
      },
    });

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Email already registered",
      },
    });
  });

  it("logs in with valid credentials and rejects an invalid password", async () => {
    await register("login-user");

    const session = await login("login-user");
    const invalidResponse = await request("/api/v1/auth/login", {
      method: "POST",
      body: {
        email: emailFor("login-user"),
        password: "WrongPassword1!",
      },
    });

    expect(session.accessToken).not.toBe("");
    expect(session.refreshToken).not.toBe("");
    expect(invalidResponse.status).toBe(401);
    await expect(readJson(invalidResponse)).resolves.toMatchObject({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      },
    });
  });

  it("rejects an unverified user before comparing the password", async () => {
    await register("unverified-user");

    // Email verification has no public flow yet, so arrange this persisted state directly.
    await prisma.user.update({
      where: { email: emailFor("unverified-user") },
      data: { emailVerifiedAt: null },
    });

    const response = await request("/api/v1/auth/login", {
      method: "POST",
      body: {
        email: emailFor("unverified-user"),
        password: "WrongPassword1!",
      },
    });

    expect(response.status).toBe(403);
    await expect(readJson(response)).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
        message: "Please verify your email",
      },
    });
  });

  it("rotates refresh tokens and revokes the family after old-token reuse", async () => {
    const session = await registerAndLogin("refresh-user");
    const refreshResponse = await request("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    });
    const refreshed = await readJson(refreshResponse);
    const refreshedData = refreshed.data as JsonObject;

    expect(refreshResponse.status).toBe(200);
    expect(refreshedData.refreshToken).toEqual(expect.any(String));
    expect(refreshedData.refreshToken).not.toBe(session.refreshToken);

    const reuseResponse = await request("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    });
    const familyRevokedResponse = await request("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: refreshedData.refreshToken },
    });

    expect(reuseResponse.status).toBe(401);
    expect(familyRevokedResponse.status).toBe(401);
  });

  it("keeps public logout idempotent and invalidates its refresh token", async () => {
    const session = await registerAndLogin("logout-user");
    const firstResponse = await request("/api/v1/auth/logout", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    });
    const secondResponse = await request("/api/v1/auth/logout", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    });
    const refreshResponse = await request("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(refreshResponse.status).toBe(401);
  });

  it("protects authenticated routes from missing and invalid bearer tokens", async () => {
    const missingProfile = await request("/api/v1/users/me");
    const invalidProfile = await request("/api/v1/users/me", {
      accessToken: "invalid-token",
    });
    const missingLogoutAll = await request("/api/v1/auth/logout-all", {
      method: "POST",
    });

    for (const response of [missingProfile, invalidProfile, missingLogoutAll]) {
      expect(response.status).toBe(401);
      await expect(readJson(response)).resolves.toMatchObject({
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        },
      });
    }
  });

  it("gets and updates the authenticated profile without leaking password hash", async () => {
    const session = await registerAndLogin("profile-user");
    const getResponse = await request("/api/v1/users/me", {
      accessToken: session.accessToken,
    });
    const getPayload = await readJson(getResponse);
    const updateResponse = await request("/api/v1/users/me", {
      method: "PATCH",
      accessToken: session.accessToken,
      body: {
        displayName: "Updated Writer",
        avatarUrl: "https://example.com/avatar.png",
      },
    });

    expect(getResponse.status).toBe(200);
    expect(getPayload).toMatchObject({
      data: {
        email: emailFor("profile-user"),
        username: "profile-user",
        displayName: "Writer profile-user",
        avatarUrl: null,
      },
    });
    expect((getPayload.data as JsonObject).passwordHash).toBeUndefined();
    expect(updateResponse.status).toBe(200);
    await expect(readJson(updateResponse)).resolves.toMatchObject({
      data: {
        displayName: "Updated Writer",
        avatarUrl: "https://example.com/avatar.png",
      },
    });

    const persistedUser = await prisma.user.findUnique({
      where: { email: emailFor("profile-user") },
    });

    expect(persistedUser).toMatchObject({
      displayName: "Updated Writer",
      avatarUrl: "https://example.com/avatar.png",
    });
  });

  it("revokes every active session through authenticated logout-all", async () => {
    await register("logout-all-user");
    const firstSession = await login("logout-all-user");
    const secondSession = await login("logout-all-user");
    const response = await request("/api/v1/auth/logout-all", {
      method: "POST",
      accessToken: firstSession.accessToken,
    });

    expect(response.status).toBe(200);

    for (const refreshToken of [
      firstSession.refreshToken,
      secondSession.refreshToken,
    ]) {
      const refreshResponse = await request("/api/v1/auth/refresh", {
        method: "POST",
        body: { refreshToken },
      });

      expect(refreshResponse.status).toBe(401);
    }
  });

  it("rejects trailing slashes on strict User/Auth routes", async () => {
    const session = await registerAndLogin("strict-user");
    const authResponse = await request("/api/v1/auth/login/", {
      method: "POST",
      body: {
        email: emailFor("strict-user"),
        password: PASSWORD,
      },
    });
    const profileResponse = await request("/api/v1/users/me/", {
      accessToken: session.accessToken,
    });

    expect(authResponse.status).toBe(404);
    expect(profileResponse.status).toBe(404);
  });
});
