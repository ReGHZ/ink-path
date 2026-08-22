import { once } from "node:events";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { displayLabelFromSymbol } from "../../src/domains/content/internal/domain/support/relationshipDefinitionSeed.js";
import { seedRelationshipDefinitions } from "../../src/domains/content/internal/infrastructure/support/PrismaRelationshipDefinitionSeeder.js";
import { createAppContainer } from "../../src/infrastructure/container.js";
import { deleteEvaluationFold } from "../helpers/foldCleanup.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// THE VERTICAL SLICE (`notes/premis-symbolic-rule-engine.md` §8b step 3).
//
// One predicate → three assertions → one rule → one evaluation, over HTTP,
// against a real database. The three outcomes asserted here are the criteria
// locked in `notes/phase-11-validation.md` BEFORE any of this code was written,
// which is what makes them a test of the premise rather than a description of
// whatever the implementation happens to do.
//
// What is actually on trial: the claim that determinism does not require the
// engine to understand what a predicate MEANS. Nothing in this file tells the
// engine what "dead" is. `dead` is a row the seeder wrote, the rule names it by
// uuid, and the answers still come out right — that is the whole premise,
// executed instead of argued.
//
// `RuleEvaluator.test.ts` proves the same three on a hand-built world. Two
// independent routes to one set of answers is what separates a reader bug from
// an evaluation bug.
//
// Its own suffix: per-file cleanup keys on it, and two files sharing one would
// delete each other's fixtures mid-run.
const EMAIL_SUFFIX = "@rule-evaluation-e2e.test";
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
    "x-request-id": `rule-evaluation-e2e-${crypto.randomUUID()}`,
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
    body: { name: "Rule evaluation project" },
  });

  expect(response.status).toBe(201);

  return (await readData(response)).projectId as string;
}

async function createCharacter(
  accessToken: string,
  projectId: string,
): Promise<string> {
  const response = await request(`/api/v1/projects/${projectId}/characters`, {
    method: "POST",
    accessToken,
    body: {
      name: "Bima",
      archetype: "mentor",
      background: "Left the academy after the second siege",
      personality: "Patient, and slow to name his reasons",
      description: "A wandering sage",
    },
  });

  expect(response.status).toBe(201);

  return (await readData(response)).characterId as string;
}

async function createChapter(
  accessToken: string,
  projectId: string,
  order: number,
): Promise<string> {
  const response = await request(`/api/v1/projects/${projectId}/chapters`, {
    method: "POST",
    accessToken,
    body: { title: `Chapter ${order}`, order },
  });

  expect(response.status).toBe(201);

  return (await readData(response)).chapterId as string;
}

async function createScene(
  accessToken: string,
  projectId: string,
  chapterId: string,
): Promise<string> {
  const response = await request(
    `/api/v1/projects/${projectId}/chapters/${chapterId}/scenes`,
    {
      method: "POST",
      accessToken,
      body: { orderInChapter: 0, title: "At the gate" },
    },
  );

  expect(response.status).toBe(201);

  return (await readData(response)).sceneId as string;
}

// The author's own predicate, written into the project's vocabulary rather than
// into the engine. `objectRequired: false` is what makes it unary — `dead(char)`
// has a subject and nothing else, the shape that had no home anywhere before
// step 2.
async function declarePredicate(
  projectId: string,
  predicate: string,
  objectRequired: boolean,
): Promise<string> {
  const created = await prisma.relationshipDefinition.create({
    data: {
      projectId,
      predicate,
      objectRequired,
      directionality: "directional",
      inverseLabel: `${predicate}_by`,
      displayLabel: displayLabelFromSymbol(predicate),
      inverseDisplayLabel: displayLabelFromSymbol(`${predicate}_by`),
      signatures: {
        create: [
          {
            subjectEntityType: "character",
            objectEntityType: objectRequired ? "scene" : null,
          },
        ],
      },
    },
  });

  return created.id;
}

// Writes straight to the assertion log. Step 3 does not route assertions
// through the transition path — that is step 4's migration — so the slice
// writes its own three facts and proves the READ path, which is the part whose
// correctness was in doubt.
async function assertFact(
  projectId: string,
  definitionId: string,
  subjectId: string,
  options: {
    objectId?: string;
    anchor?: { type: "chapter" | "scene" | "event"; id: string };
  } = {},
): Promise<string> {
  const created = await prisma.assertion.create({
    data: {
      projectId,
      narrativeTransitionId: null,
      relationshipDefinitionId: definitionId,
      operation: "relationship_add",
      targetEntityType: "character",
      targetEntityId: subjectId,
      relatedEntityType: options.objectId === undefined ? null : "scene",
      relatedEntityId: options.objectId ?? null,
      anchorEntityType: options.anchor?.type ?? null,
      anchorEntityId: options.anchor?.id ?? null,
    },
  });

  return created.id;
}

function ruleFor(deadId: string, appearsInId: string) {
  return {
    version: "1",
    bindings: [
      { name: "char", entity_type: "character", quantifier: "exists" },
      { name: "sc", entity_type: "scene", quantifier: "exists" },
    ],
    condition: {
      type: "and",
      conditions: [
        {
          type: "relation_atom",
          subject: "char",
          predicate_ref: { type: "predicate_ref", definition_id: appearsInId },
          object: "sc",
        },
        {
          type: "relation_atom",
          subject: "char",
          predicate_ref: { type: "predicate_ref", definition_id: deadId },
          at: { binding: "sc" },
        },
      ],
    },
    severity: "error",
    message_template: "{{char.name}} muncul padahal sudah mati pada cut itu",
  };
}

async function evaluate(
  accessToken: string,
  projectId: string,
  ast: unknown,
): Promise<Response> {
  return request(`/api/v1/projects/${projectId}/rule-evaluations`, {
    method: "POST",
    accessToken,
    body: { ast },
  });
}

// Builds a world in which the death is anchored to `deathChapterOrder` and the
// character appears in a scene sitting in `sceneChapterOrder`. When
// `anchorDeathToEvent` is set the death is anchored to an event instead — an
// entity the diegetic axis would place and no projection materialises yet, so
// its order against the scene is genuinely underivable.
async function buildWorld(
  accessToken: string,
  options: {
    deathChapterOrder: number;
    sceneChapterOrder: number;
    anchorDeathToEvent?: boolean;
  },
) {
  const projectId = await createProject(accessToken);

  await seedRelationshipDefinitions(prisma, projectId);

  const deadId = await declarePredicate(projectId, "dead", false);
  const appearsInId = await declarePredicate(projectId, "appears_in_scene", true);

  const characterId = await createCharacter(accessToken, projectId);
  const deathChapterId = await createChapter(
    accessToken,
    projectId,
    options.deathChapterOrder,
  );
  const sceneChapterId = await createChapter(
    accessToken,
    projectId,
    options.sceneChapterOrder,
  );
  const sceneId = await createScene(accessToken, projectId, sceneChapterId);

  let deathAnchor: { type: "chapter" | "event"; id: string } = {
    type: "chapter",
    id: deathChapterId,
  };

  if (options.anchorDeathToEvent === true) {
    const owner = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { ownerUserId: true },
    });

    const event = await prisma.event.create({
      data: {
        projectId,
        createdByUserId: owner.ownerUserId,
        title: "A death nobody dated",
        // `timelineOrder` left null on purpose: it is the diegetic hint, not a
        // source of truth, and nothing derives an order from it. Filling it in
        // would hide the very condition this test exists to produce.
        timelineOrder: null,
      },
    });

    deathAnchor = { type: "event", id: event.id };
  }

  await assertFact(projectId, appearsInId, characterId, { objectId: sceneId });
  await assertFact(projectId, deadId, characterId, { anchor: deathAnchor });

  return { projectId, ast: ruleFor(deadId, appearsInId) };
}

beforeAll(async () => {
  process.env.JWT_SECRET = "rule-evaluation-e2e-test-secret";

  const container = createAppContainer();
  const app = createApp(container);
  prisma = container.resolve("prisma");
  server = serve({ fetch: app.fetch, port: 0 });

  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Rule evaluation E2E server did not expose a TCP port");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  if (userIds.length === 0) {
    return;
  }

  const projects = await prisma.project.findMany({
    where: { ownerUserId: { in: userIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length > 0) {
    // Assertions before definitions before content: every FK on this path is
    // onDelete: Restrict, so any other order fails instead of cascading, and
    // the failure would surface inside an unrelated test's fixtures.
    await deleteEvaluationFold(prisma, projectIds);
    await prisma.assertion.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.relationshipDefinition.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.scene.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.chapter.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.character.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.event.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.contentRevision.deleteMany({
      where: { projectId: { in: projectIds } },
    });
  }

  await prisma.userProject.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.project.deleteMany({ where: { ownerUserId: { in: userIds } } });
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

describe("rule evaluation — the vertical slice", () => {
  it("answers conflict: the character speaks in a chapter after the one he died in", async () => {
    const accessToken = await registerAndLogin("ruleeval-conflict");
    const { projectId, ast } = await buildWorld(accessToken, {
      deathChapterOrder: 12,
      sceneChapterOrder: 30,
    });

    const response = await evaluate(accessToken, projectId, ast);

    expect(response.status).toBe(200);
    expect(await readData(response)).toEqual({ outcome: "conflict" });
  });

  it("answers valid: the scene sits before the death", async () => {
    const accessToken = await registerAndLogin("ruleeval-valid");
    const { projectId, ast } = await buildWorld(accessToken, {
      deathChapterOrder: 12,
      sceneChapterOrder: 5,
    });

    const response = await evaluate(accessToken, projectId, ast);

    expect(response.status).toBe(200);
    expect(await readData(response)).toEqual({ outcome: "valid" });
  });

  // The answer the design cares about most. The engine does not know whether
  // the death came before the scene, and says so instead of guessing — which is
  // the point at which the AI path takes over. Guessing `false` here would
  // report a clean bill of health while blind; guessing `true` would report a
  // contradiction that may not exist.
  it("answers unsupported: the death's order against the scene is not derivable", async () => {
    const accessToken = await registerAndLogin("ruleeval-unsupported");
    const { projectId, ast } = await buildWorld(accessToken, {
      deathChapterOrder: 12,
      sceneChapterOrder: 30,
      anchorDeathToEvent: true,
    });

    const response = await evaluate(accessToken, projectId, ast);

    expect(response.status).toBe(200);
    expect(await readData(response)).toEqual({ outcome: "unsupported" });
  });

  it("refuses a rule the grammar does not accept", async () => {
    const accessToken = await registerAndLogin("ruleeval-malformed");
    const { projectId, ast } = await buildWorld(accessToken, {
      deathChapterOrder: 12,
      sceneChapterOrder: 30,
    });

    const response = await evaluate(accessToken, projectId, {
      ...ast,
      bindings: [
        { name: "char", entity_type: "character", quantifier: "exists" },
        // Safety rule 7: a duplicate name makes an atom point at a different
        // entity than the author is reading, with no error anywhere.
        { name: "char", entity_type: "scene", quantifier: "exists" },
      ],
    });

    expect(response.status).toBe(400);
  });

  // Tenancy, proved rather than assumed: one project's vocabulary and facts must
  // not answer another project's rule. Same author, same predicate name, and the
  // definition uuids differ — so a leak would show up as `conflict` here.
  it("does not read another project's facts", async () => {
    const accessToken = await registerAndLogin("ruleeval-tenancy");
    const { ast } = await buildWorld(accessToken, {
      deathChapterOrder: 12,
      sceneChapterOrder: 30,
    });
    const neighbourProjectId = await createProject(accessToken);

    const response = await evaluate(accessToken, neighbourProjectId, ast);

    expect(response.status).toBe(200);
    expect(await readData(response)).toEqual({ outcome: "valid" });
  });
});
