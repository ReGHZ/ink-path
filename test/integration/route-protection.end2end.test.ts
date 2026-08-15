import { once } from "node:events";

import { serve } from "@hono/node-server";
import { asValue } from "awilix";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp, type App } from "../../src/app.js";
import { createAppContainer } from "../../src/infrastructure/container.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Two invariants about the `/api/v1/projects` surface, both enforced by walking
// the router's OWN registration table rather than a hand-written list — so a
// route added in a later phase is covered the moment it is mounted, and a route
// that quietly loses its protection fails here instead of in production.
//
//   1. No project-scoped route answers without authentication.
//   2. No route carrying `:projectId` answers to a non-member.
//   3. Each middleware runs exactly ONCE per request.
//
// (3) is the lock on the regression that motivated createProjectScopedRouter:
// when every entity router declared its own copy of the middleware and all of
// them were mounted on the same prefix, Hono merged the registrations and ran
// them 10-11 times per request — 10-11 identical membership queries. Nothing
// failed, which is exactly why it survived several quality gates. A number
// asserted here cannot drift silently again.

const EMAIL_SUFFIX = "@route-protection-e2e.test";
const PASSWORD = "CorrectPassword1!";

type JsonObject = Record<string, unknown>;

let server: ReturnType<typeof serve>;
let app: App;
let baseUrl: string;
let prisma: PrismaClient;

const middlewareRuns = { auth: 0, member: 0 };

function headers(accessToken?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-request-id": `route-protection-${crypto.randomUUID()}`,
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

// `/projects/:projectId/chapters/:chapterId/status` -> a concrete path with
// syntactically valid ids that belong to nobody.
function concretePath(routePath: string): string {
  return routePath
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? crypto.randomUUID() : segment,
    )
    .join("/");
}

function projectScopedRoutes() {
  return app.routes.filter(
    (route) =>
      route.method !== "ALL" && route.path.startsWith("/api/v1/projects"),
  );
}

async function registerAndLogin(name: string): Promise<string> {
  const email = `${name}${EMAIL_SUFFIX}`;

  await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      username: name,
      displayName: `Route ${name}`,
    }),
  });

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const payload = (await login.json()) as JsonObject;

  return (payload.data as JsonObject).accessToken as string;
}

beforeAll(async () => {
  process.env.JWT_SECRET = "route-protection-e2e-secret";

  const container = createAppContainer();

  // Wrap the middleware themselves, not the queries underneath: the claim being
  // locked is "this middleware executes once per request", which is a property
  // of the routing table, not of any cache.
  const originalAuth = container.resolve("authMiddleware");
  const originalMember = container.resolve("projectMemberMiddleware");

  container.register(
    "authMiddleware",
    asValue(async (c: Parameters<typeof originalAuth>[0], next: () => Promise<void>) => {
      middlewareRuns.auth += 1;
      return originalAuth(c, next);
    }),
  );
  container.register(
    "projectMemberMiddleware",
    asValue(
      async (
        c: Parameters<typeof originalMember>[0],
        next: () => Promise<void>,
      ) => {
        middlewareRuns.member += 1;
        return originalMember(c, next);
      },
    ),
  );

  prisma = container.resolve("prisma");
  app = createApp(container);
  server = serve({ fetch: app.fetch, port: 0 });

  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Route protection E2E server did not expose a TCP port");
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
      // Deliberately wider than what this file creates today (chapter + scene).
      // A cleanup scoped to the current fixtures degrades silently the moment a
      // test here starts creating something else: nothing fails, the rows just
      // linger and collide with another file's fixtures — the exact failure
      // that cost a REJECT in Phase 4. Scenes before chapters, because
      // `scenes.chapter_id` is onDelete: Restrict.
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
      await prisma.character.deleteMany({
        where: { projectId: { in: projectIds } },
      });
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

describe("Project-scoped route protection", () => {
  it("has every project-scoped router present in the routing table", () => {
    // Guards the tests below from passing vacuously — an empty route list would
    // make "every route is protected" trivially true.
    //
    // One entry per route FILE, keyed on a fragment unique to it, rather than a
    // lower bound on the total count. A count cannot tell a small module from a
    // missing one: with 62 routes today, losing all of Content leaves 8 and any
    // floor catches it, but losing the whole Project module leaves 54 and a
    // floor of 50 stays green. Presence-per-router goes red either way, and it
    // does not need editing every time a phase adds routes.
    const routes = projectScopedRoutes();
    const mountedSurfaces: Array<[string, string]> = [
      ["projectRoutes", "/activate"],
      ["userProjectRoutes", "/members"],
      ["layerRoutes", "/layers"],
      ["worldMapRoutes", "/world-maps"],
      ["worldElementRoutes", "/world-elements"],
      ["factionRoutes", "/factions"],
      ["characterRoutes", "/characters"],
      ["eventRoutes", "/events"],
      ["plotRoutes", "/plots"],
      // Not plain "/chapters": sceneRoutes' nested collection contains that too,
      // so it would stay green with chapterRoutes entirely unmounted.
      ["chapterRoutes", "/chapters/:chapterId/status"],
      ["sceneRoutes (nested collection)", "/chapters/:chapterId/scenes"],
      ["sceneRoutes (flat item)", "/scenes/:sceneId"],
      // Two entries for the one router, for the same reason chapterRoutes needs
      // a discriminating fragment: the nine nested list paths all end in
      // "/relationships", so a lone "/relationships" marker stays green with the
      // entire flat CRUD block unmounted — and a lone flat marker stays green
      // with all nine nested routes gone.
      ["relationshipRoutes (flat item)", "/relationships/:relationshipId"],
      [
        "relationshipRoutes (nested list)",
        "/characters/:characterId/relationships",
      ],
    ];

    for (const [router, fragment] of mountedSurfaces) {
      expect(
        routes.some((route) => route.path.includes(fragment)),
        `${router} is mounted (no route matching ${fragment})`,
      ).toBe(true);
    }
  });

  it("answers 401 on every project-scoped route when no token is sent", async () => {
    for (const route of projectScopedRoutes()) {
      const response = await fetch(`${baseUrl}${concretePath(route.path)}`, {
        method: route.method,
        headers: headers(),
        body: route.method === "GET" || route.method === "DELETE"
          ? undefined
          : JSON.stringify({}),
      });

      expect(
        response.status,
        `${route.method} ${route.path} without a token`,
      ).toBe(401);
    }
  });

  it("answers 404 on every :projectId route when the caller is not a member", async () => {
    const accessToken = await registerAndLogin("outsider");

    for (const route of projectScopedRoutes()) {
      if (!route.path.includes(":projectId")) {
        continue;
      }

      const response = await fetch(`${baseUrl}${concretePath(route.path)}`, {
        method: route.method,
        headers: headers(accessToken),
        body: route.method === "GET" || route.method === "DELETE"
          ? undefined
          : JSON.stringify({}),
      });

      // 404 rather than 403: never confirm that a project id exists but is
      // someone else's. The membership check runs before the handler, so this
      // holds even for the routes whose bodies here are deliberately invalid.
      expect(
        response.status,
        `${route.method} ${route.path} as a non-member`,
      ).toBe(404);
    }
  });

  it("answers 404, not 500, when an id in the path is not a uuid", async () => {
    const accessToken = await registerAndLogin("malformed");

    const projectResponse = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: headers(accessToken),
      body: JSON.stringify({ name: "Malformed Id Project" }),
    });

    expect(projectResponse.status).toBe(201);
    const projectId = (
      ((await projectResponse.json()) as JsonObject).data as JsonObject
    ).projectId as string;

    // Every case below answered 500 INTERNAL_ERROR before 2026-08-15: the value
    // reached Prisma, which raised P2007, which nothing translated. A client
    // mistake reported as a server fault is not cosmetic — retry-on-5xx callers
    // repeat a request that can never succeed, and the 5xx rate stops being a
    // usable alert signal.
    //
    // The `:projectId` rows are the load-bearing ones: they are guarded in
    // ProjectMemberMiddleware, so they hold for EVERY project-scoped route,
    // including the ~62 inherited from Phase 2-6 whose own entity ids are still
    // unguarded (deliberate scope split — see notes/tech-debt.md).
    const malformedPaths: Array<[string, string, string]> = [
      ["GET", `/api/v1/projects/not-a-uuid`, "projectId, bare"],
      ["GET", `/api/v1/projects/not-a-uuid/characters`, "projectId, collection"],
      [
        "GET",
        `/api/v1/projects/${projectId}/relationships/not-a-uuid`,
        "relationshipId",
      ],
      [
        "PATCH",
        `/api/v1/projects/${projectId}/relationships/not-a-uuid`,
        "relationshipId, write path",
      ],
      [
        "DELETE",
        `/api/v1/projects/${projectId}/relationships/not-a-uuid`,
        "relationshipId, delete path",
      ],
      [
        "GET",
        `/api/v1/projects/${projectId}/characters/not-a-uuid/relationships`,
        "nested entity id",
      ],
    ];

    for (const [method, path, label] of malformedPaths) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: headers(accessToken),
        body: method === "PATCH" ? JSON.stringify({ note: null }) : undefined,
      });

      expect(response.status, `${method} ${path} (${label})`).toBe(404);
    }

    // Control: a syntactically valid id that simply does not exist must answer
    // the same 404 through the same route. Without it, a guard that rejected
    // every id would pass the loop above.
    const absent = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/relationships/${crypto.randomUUID()}`,
      { method: "GET", headers: headers(accessToken) },
    );

    expect(absent.status).toBe(404);
  });

  it("runs each middleware exactly once per request, at any route depth", async () => {
    const accessToken = await registerAndLogin("member");

    const projectResponse = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: headers(accessToken),
      body: JSON.stringify({ name: "Route Protection Project" }),
    });

    expect(projectResponse.status).toBe(201);
    const projectId = ((await projectResponse.json()) as JsonObject).data as
      | JsonObject
      | undefined;
    const id = projectId?.projectId as string;

    const chapterResponse = await fetch(
      `${baseUrl}/api/v1/projects/${id}/chapters`,
      {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ title: "C1", order: 1 }),
      },
    );

    expect(chapterResponse.status).toBe(201);
    const chapterId = (
      ((await chapterResponse.json()) as JsonObject).data as JsonObject
    ).chapterId as string;

    const sceneResponse = await fetch(
      `${baseUrl}/api/v1/projects/${id}/chapters/${chapterId}/scenes`,
      {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ orderInChapter: 0 }),
      },
    );

    expect(sceneResponse.status).toBe(201);
    const sceneId = (
      ((await sceneResponse.json()) as JsonObject).data as JsonObject
    ).sceneId as string;

    // Four depths, because the old duplication scaled with path depth: the
    // 2-segment collection path used to run the membership check 10 times and
    // the 3-segment ones 11.
    const paths = [
      `/api/v1/projects/${id}`,
      `/api/v1/projects/${id}/chapters`,
      `/api/v1/projects/${id}/scenes/${sceneId}`,
      `/api/v1/projects/${id}/chapters/${chapterId}/scenes`,
    ];

    for (const path of paths) {
      middlewareRuns.auth = 0;
      middlewareRuns.member = 0;

      const response = await fetch(`${baseUrl}${path}`, {
        headers: headers(accessToken),
      });

      expect(response.status, `GET ${path}`).toBe(200);
      expect(middlewareRuns.auth, `auth middleware runs for GET ${path}`).toBe(
        1,
      );
      expect(
        middlewareRuns.member,
        `membership middleware runs for GET ${path}`,
      ).toBe(1);
    }
  });
});
