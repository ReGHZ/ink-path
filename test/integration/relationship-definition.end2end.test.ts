import { once } from "node:events";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createAppContainer } from "../../src/infrastructure/container.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Its own email suffix and its own username prefix: `users.username` is UNIQUE
// GLOBALLY, so two files sharing a name delete each other's fixtures
// intermittently (`notes/jangan-diregresi.md` §Konvensi test integration).
const EMAIL_SUFFIX = "@definition-e2e.test";
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
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<Response> {
  const headers = new Headers({
    "x-request-id": `definition-e2e-${crypto.randomUUID()}`,
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

async function readData(response: Response): Promise<JsonObject> {
  const payload = (await response.json()) as JsonObject;

  return payload.data as JsonObject;
}

async function readError(response: Response): Promise<JsonObject> {
  const payload = (await response.json()) as JsonObject;

  return payload.error as JsonObject;
}

async function registerAndLogin(name: string): Promise<string> {
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

  expect(loginResponse.status).toBe(200);

  return (await readData(loginResponse)).accessToken as string;
}

async function createProject(accessToken: string): Promise<string> {
  const response = await request("/api/v1/projects", {
    method: "POST",
    accessToken,
    body: { name: "Vocabulary project" },
  });

  expect(response.status).toBe(201);

  // NO `seedProjectVocabulary` here, unlike the relationship suites: a project
  // is born with an EMPTY vocabulary (the seeder hook is deliberately not
  // installed, B-8), and this endpoint is the reason that is survivable.
  return (await readData(response)).projectId as string;
}

// Straight to the row, because `POST /projects` makes the caller the OWNER and
// there is no HTTP route that hands somebody a Reviewer seat — without this the
// Reviewer half of the permission matrix is unreachable over HTTP. Mirrors
// `seedMembership` in `content-relationship.end2end.test.ts`.
async function seedMembership(
  projectId: string,
  username: string,
  role: "writer" | "editor" | "reviewer",
  canDelete: boolean,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: emailFor(username) },
    select: { id: true },
  });

  await prisma.userProject.create({
    data: {
      id: crypto.randomUUID(),
      projectId,
      userId: user.id,
      role,
      canDelete,
      aiAccess: "full",
      status: "active",
      joinedAt: new Date(),
    },
  });
}

function definitionBody(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    label: "mentors",
    objectRequired: true,
    directionality: "directional",
    signatures: [
      { subjectEntityType: "character", objectEntityType: "character" },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.JWT_SECRET = "definition-e2e-test-secret";

  const container = createAppContainer();
  const app = createApp(container);

  prisma = container.resolve("prisma");
  server = serve({ fetch: app.fetch, port: 0 });
  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Definition E2E server did not expose a TCP port");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  if (userIds.length === 0) {
    return;
  }

  const projects = await prisma.project.findMany({
    where: { ownerUserId: { in: userIds } },
    select: { id: true },
  });
  const projectIds = projects.map((project) => project.id);

  if (projectIds.length > 0) {
    // Definitions before projects: `relationship_definitions.project_id` is
    // onDelete: Restrict, so a leftover row fails the project delete instead of
    // cascading — and it would surface inside another test's fixtures.
    await prisma.relationshipDefinition.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.userProject.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  }

  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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

describe("Relationship definition end-to-end", () => {
  it("creates a predicate from one word the author typed and lists it back", async () => {
    const accessToken = await registerAndLogin("defe2ecreate");
    const projectId = await createProject(accessToken);

    const created = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      {
        method: "POST",
        accessToken,
        body: definitionBody({ label: "menikah dengan" }),
      },
    );

    expect(created.status).toBe(201);

    const body = await readData(created);

    // The author typed a phrase; the SYMBOL was derived and never asked for.
    expect(body.label).toBe("menikah dengan");
    expect(body.predicate).toBe("menikah_dengan");
    // Absent inverse reads the same, exactly like the non-directional seeds.
    expect(body.inverseLabel).toBe("menikah dengan");

    const listed = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { accessToken },
    );

    expect(listed.status).toBe(200);
    expect((await readData(listed)).definitions).toHaveLength(1);
  });

  it("accepts a label in a script the symbol cannot represent", async () => {
    const accessToken = await registerAndLogin("defe2escript");
    const projectId = await createProject(accessToken);

    const created = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      {
        method: "POST",
        accessToken,
        body: definitionBody({ label: "結婚", inverseLabel: "配偶者" }),
      },
    );

    expect(created.status).toBe(201);

    const body = await readData(created);

    expect(body.label).toBe("結婚");
    expect(body.inverseLabel).toBe("配偶者");
    // The RESERVED namespace exactly (`RESERVED_GENERATED_SYMBOL` in the
    // domain), not a looser `[a-z0-9]`: a generated symbol that lands outside it
    // is a symbol a LABEL could also derive, and the collision it opens has no
    // other guard (gate B8, mutant M-3).
    expect(body.predicate).toMatch(/^p_[0-9a-f]{1,12}$/);
  });

  it("creates a unary predicate — the shape the rule engine's example needs", async () => {
    const accessToken = await registerAndLogin("defe2eunary");
    const projectId = await createProject(accessToken);

    const created = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      {
        method: "POST",
        accessToken,
        body: definitionBody({
          label: "mati",
          objectRequired: false,
          signatures: [
            { subjectEntityType: "character", objectEntityType: null },
          ],
        }),
      },
    );

    expect(created.status).toBe(201);

    const body = await readData(created);

    expect(body.objectRequired).toBe(false);
    expect(body.signatures).toEqual([
      { subjectEntityType: "character", objectEntityType: null },
    ]);
  });

  it("answers 409 when the same word is defined twice", async () => {
    const accessToken = await registerAndLogin("defe2edup");
    const projectId = await createProject(accessToken);

    const first = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { method: "POST", accessToken, body: definitionBody() },
    );

    expect(first.status).toBe(201);

    const second = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { method: "POST", accessToken, body: definitionBody() },
    );

    expect(second.status).toBe(409);
    expect((await readError(second)).code).toBe("CONFLICT");
  });

  it("answers 400 for a structural hierarchy pair, at DEFINE time", async () => {
    const accessToken = await registerAndLogin("defe2ehier");
    const projectId = await createProject(accessToken);

    const response = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      {
        method: "POST",
        accessToken,
        body: definitionBody({
          label: "contains",
          signatures: [
            { subjectEntityType: "chapter", objectEntityType: "scene" },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(await readError(response))).toMatch(
      /structural hierarchy/,
    );
  });

  it("forbids a Reviewer from writing the vocabulary but not from reading it", async () => {
    const ownerToken = await registerAndLogin("defe2erevowner");
    const projectId = await createProject(ownerToken);
    const reviewerToken = await registerAndLogin("defe2ereviewer");

    await seedMembership(projectId, "defe2ereviewer", "reviewer", false);

    const written = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { method: "POST", accessToken: reviewerToken, body: definitionBody() },
    );

    // The STATUS, not the sentence. Asserting the message let the error CODE be
    // demoted (403 → 400) with nothing red, and let the controller hand the
    // service a hardcoded `"writer"` instead of the role the middleware read —
    // a Reviewer writing project vocabulary, undetected (gate B8-1, mutants M-1
    // and M-4). This is the only test that runs the role through the real
    // middleware → controller → service chain.
    expect(written.status).toBe(403);

    const listed = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { accessToken: reviewerToken },
    );

    expect(listed.status).toBe(200);
  });

  it("answers 409 for one word typed twice in a script the symbol cannot carry", async () => {
    const accessToken = await registerAndLogin("defe2edupscript");
    const projectId = await createProject(accessToken);
    const body = definitionBody({ label: "結婚", inverseLabel: "配偶者" });

    const first = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { method: "POST", accessToken, body },
    );

    expect(first.status).toBe(201);

    // Each of these derives NO symbol, so each gets its own opaque one and the
    // symbol index is blind to the pair. Before the label index this answered
    // 201 twice and left two rows reading `結婚` in the author's list.
    const second = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { method: "POST", accessToken, body },
    );

    expect(second.status).toBe(409);
  });

  it("names the WORDING OF THE EXISTING ROW in the conflict", async () => {
    const accessToken = await registerAndLogin("defe2edupwording");
    const projectId = await createProject(accessToken);

    await request(`/api/v1/projects/${projectId}/relationship-definitions`, {
      method: "POST",
      accessToken,
      body: definitionBody({ label: "mati (fisik)" }),
    });

    const second = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      {
        method: "POST",
        accessToken,
        body: definitionBody({ label: "mati fisik" }),
      },
    );

    expect(second.status).toBe(409);
    // The author has to find the winning row in a list; the text they just typed
    // is not in it (gate B8-2, mutant M-2).
    expect(JSON.stringify(await readError(second))).toContain("mati (fisik)");
  });

  it("answers an arity clash with ARITY even when the symbol is opaque", async () => {
    const accessToken = await registerAndLogin("defe2earityscript");
    const projectId = await createProject(accessToken);

    const unary = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      {
        method: "POST",
        accessToken,
        body: definitionBody({
          label: "結婚",
          objectRequired: false,
          signatures: [
            { subjectEntityType: "character", objectEntityType: null },
          ],
        }),
      },
    );

    expect(unary.status).toBe(201);

    const binary = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      {
        method: "POST",
        accessToken,
        body: definitionBody({ label: "結婚" }),
      },
    );

    expect(binary.status).toBe(409);
    // `05-implementation-policy/02` §ADDENDUM 2026-08-22 butir 2 promises an
    // ARITY sentence for an arity clash, and promises it without a clause about
    // script. A message about punctuation here would send a Japanese author
    // renaming a word that was never the problem (gate B8P-3).
    expect(JSON.stringify(await readError(binary))).toContain(
      "one name is one arity per project",
    );
  });

  it("does not ask for directionality — it defaults to directional", async () => {
    const accessToken = await registerAndLogin("defe2edefaultdir");
    const projectId = await createProject(accessToken);
    const body = definitionBody();

    // `notes/usulan-ux-pencatatan-fakta.md` §9.4: not a question the author is
    // asked. Symmetry rewrites canonical orientation at write time, so it is
    // changed later from the vocabulary page while the predicate has no facts.
    delete body.directionality;

    const created = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { method: "POST", accessToken, body },
    );

    expect(created.status).toBe(201);
    expect((await readData(created)).directionality).toBe("directional");
  });

  it("does not leak another project's vocabulary", async () => {
    const ownerToken = await registerAndLogin("defe2eowner");
    const projectId = await createProject(ownerToken);

    await request(`/api/v1/projects/${projectId}/relationship-definitions`, {
      method: "POST",
      accessToken: ownerToken,
      body: definitionBody(),
    });

    const strangerToken = await registerAndLogin("defe2estranger");

    const response = await request(
      `/api/v1/projects/${projectId}/relationship-definitions`,
      { accessToken: strangerToken },
    );

    // 404, not 403: the project-scoped middleware answers the same for "does not
    // exist" and "not yours", so membership is not an existence oracle.
    expect(response.status).toBe(404);
  });
});
