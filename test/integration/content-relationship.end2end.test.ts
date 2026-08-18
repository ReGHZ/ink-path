import { once } from "node:events";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createAppContainer } from "../../src/infrastructure/container.js";
import { seedProjectVocabulary } from "../helpers/relationshipVocabulary.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Its own suffix, not shared with content.end2end.test.ts: the per-file cleanup
// keys on it, and two files sharing one suffix would delete each other's
// fixtures mid-run.
const EMAIL_SUFFIX = "@relationship-e2e.test";
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
    "x-request-id": `relationship-e2e-${crypto.randomUUID()}`,
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

  expect(loginResponse.status).toBe(200);
  const data = await readData(loginResponse);

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

  const projectId = (await readData(response)).projectId as string;

  // Every relationship this suite writes needs its predicate to exist — the
  // composite foreign key added in step 4.
  await seedProjectVocabulary(prisma, projectId);

  return projectId;
}

async function createCharacter(
  accessToken: string,
  projectId: string,
  name: string,
): Promise<string> {
  const response = await request(`/api/v1/projects/${projectId}/characters`, {
    method: "POST",
    accessToken,
    body: {
      name,
      archetype: "mentor",
      background: "Left the academy after the second siege",
      personality: "Patient, and slow to name her reasons",
      description: "A wandering sage",
    },
  });

  expect(response.status).toBe(201);

  return (await readData(response)).characterId as string;
}

async function createFaction(
  accessToken: string,
  projectId: string,
  name: string,
): Promise<string> {
  const response = await request(`/api/v1/projects/${projectId}/factions`, {
    method: "POST",
    accessToken,
    body: {
      name,
      description: "A knightly order",
      background: "Founded after the war",
    },
  });

  expect(response.status).toBe(201);

  return (await readData(response)).factionId as string;
}

// Seeded straight into `user_projects`: there is no invitation API yet (Phase
// 12) and the project creator is always writer + canDelete, so every other point
// of the permission matrix is unreachable over HTTP. Mirrors seedMembership in
// content.end2end.test.ts.
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

function createRelationship(
  accessToken: string,
  projectId: string,
  body: JsonObject,
): Promise<Response> {
  return request(`/api/v1/projects/${projectId}/relationships`, {
    method: "POST",
    accessToken,
    body,
  });
}

beforeAll(async () => {
  process.env.JWT_SECRET = "relationship-e2e-test-secret";

  const container = createAppContainer();
  const app = createApp(container);
  prisma = container.resolve("prisma");
  server = serve({ fetch: app.fetch, port: 0 });

  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Relationship E2E server did not expose a TCP port");
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
    // Relationships FIRST: `content_relationships.project_id` is onDelete:
    // Restrict, so a leftover row makes the project delete below fail rather
    // than cascade — and the failure would surface as an unrelated test's
    // fixture error.
    await prisma.contentRelationship.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.character.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.faction.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.contentRevision.deleteMany({
      where: { projectId: { in: projectIds } },
    });
  }

  await prisma.userProject.deleteMany({ where: { userId: { in: userIds } } });
  // Predicate vocabulary before the project: `relationship_definitions` is
  // onDelete: Restrict, so a project still holding its vocabulary refuses to be
  // deleted. Consequence of step 4, and the reason this belongs in a cleanup
  // helper rather than in each test.
  await prisma.relationshipDefinition.deleteMany({
    where: { project: { ownerUserId: { in: userIds } } },
  });
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

describe("Content relationship end-to-end", () => {
  it("round-trips create, read, list from both sides, patch and delete", async () => {
    const session = await registerAndLogin("rel-crud");
    const projectId = await createProject(session.accessToken, "Relationship CRUD");
    const basePath = `/api/v1/projects/${projectId}`;
    const characterId = await createCharacter(
      session.accessToken,
      projectId,
      "Aria",
    );
    const factionId = await createFaction(
      session.accessToken,
      projectId,
      "Silver Hand",
    );

    const created = await createRelationship(session.accessToken, projectId, {
      sourceEntityType: "character",
      sourceEntityId: characterId,
      targetEntityType: "faction",
      targetEntityId: factionId,
      relationType: "member_of",
      note: "Sworn in after the siege",
    });

    expect(created.status).toBe(201);
    const relationship = await readData(created);

    // 201 returns the WHOLE row, not `{ id }` like Phase 4-6 creates: the caller
    // cannot reconstruct it, because canonicalisation may have swapped the
    // endpoints it sent (Flow 4 step 10).
    expect(relationship).toMatchObject({
      projectId,
      sourceEntityType: "character",
      sourceEntityId: characterId,
      targetEntityType: "faction",
      targetEntityId: factionId,
      relationType: "member_of",
      note: "Sworn in after the siege",
      createdByUserId: session.userId,
    });
    // K4: `version` must never cross the wire, in either direction.
    expect(relationship).not.toHaveProperty("version");

    const relationshipId = relationship.id as string;

    const fetched = await request(`${basePath}/relationships/${relationshipId}`, {
      accessToken: session.accessToken,
    });

    expect(fetched.status).toBe(200);
    const fetchedRelationship = await readData(fetched);

    expect(fetchedRelationship.id).toBe(relationshipId);
    // The item shape carries no perspective: there is no entity to read it from.
    expect(fetchedRelationship).not.toHaveProperty("direction");
    expect(fetchedRelationship).not.toHaveProperty("label");

    const fromCharacter = await request(
      `${basePath}/characters/${characterId}/relationships`,
      { accessToken: session.accessToken },
    );

    expect(fromCharacter.status).toBe(200);
    expect((await readData(fromCharacter)).relationships).toMatchObject([
      { id: relationshipId, direction: "outgoing", label: "member_of" },
    ]);

    // Same row, other endpoint: the label flips to the registry's inverse. This
    // is the whole reason the computation lives in the DTO mapper — the faction
    // is not `member_of` the character.
    const fromFaction = await request(
      `${basePath}/factions/${factionId}/relationships`,
      { accessToken: session.accessToken },
    );

    expect(fromFaction.status).toBe(200);
    expect((await readData(fromFaction)).relationships).toMatchObject([
      { id: relationshipId, direction: "incoming", label: "has_member" },
    ]);

    const patched = await request(`${basePath}/relationships/${relationshipId}`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { note: "Reinstated" },
    });

    expect(patched.status).toBe(200);
    expect((await readData(patched)).note).toBe("Reinstated");

    const cleared = await request(`${basePath}/relationships/${relationshipId}`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: { note: null },
    });

    expect(cleared.status).toBe(200);
    expect((await readData(cleared)).note).toBeNull();

    const deleted = await request(`${basePath}/relationships/${relationshipId}`, {
      method: "DELETE",
      accessToken: session.accessToken,
    });

    expect(deleted.status).toBe(200);

    // Item 13's third clause, and the only one of the three that HTTP can
    // schedule deterministically: deleting a row that is genuinely gone is 404,
    // not the 409 a stale guard produces. The other two clauses need two loads
    // of one row and live in content-relationship-repository.integration.test.ts.
    const deletedAgain = await request(
      `${basePath}/relationships/${relationshipId}`,
      { method: "DELETE", accessToken: session.accessToken },
    );

    expect(deletedAgain.status).toBe(404);

    const emptyList = await request(
      `${basePath}/characters/${characterId}/relationships`,
      { accessToken: session.accessToken },
    );

    expect((await readData(emptyList)).relationships).toEqual([]);
  });

  it("rejects the same non-directional relationship written in reverse", async () => {
    const session = await registerAndLogin("rel-dedup");
    const projectId = await createProject(session.accessToken, "Relationship Dedup");
    const first = await createCharacter(session.accessToken, projectId, "Aria");
    const second = await createCharacter(session.accessToken, projectId, "Bran");

    const created = await createRelationship(session.accessToken, projectId, {
      sourceEntityType: "character",
      sourceEntityId: first,
      targetEntityType: "character",
      targetEntityId: second,
      relationType: "ally_of",
    });

    expect(created.status).toBe(201);

    // B->A for a non-directional type is the SAME relationship. Nothing reads
    // before writing (K5): the domain canonicalises, Postgres' six-column unique
    // index refuses it, and the adapter turns that into a duplicate — this is
    // the first time that whole chain runs against a real database over HTTP.
    const mirrored = await createRelationship(session.accessToken, projectId, {
      sourceEntityType: "character",
      sourceEntityId: second,
      targetEntityType: "character",
      targetEntityId: first,
      relationType: "ally_of",
    });

    expect(mirrored.status).toBe(409);
    // Asserting the MESSAGE, not the code: a version conflict is also 409, and
    // the two must not collapse — one is fixed by not re-adding the link, the
    // other by retrying.
    expect((await readError(mirrored)).message).toMatch(/already exists/i);

    const list = await request(
      `/api/v1/projects/${projectId}/characters/${first}/relationships`,
      { accessToken: session.accessToken },
    );

    const listed = (await readData(list)).relationships as JsonObject[];

    expect(listed).toHaveLength(1);
    // Non-directional: which side ended up as `source` is decided by
    // lexicographic order, so reporting outgoing/incoming would be reporting a
    // sorting artefact.
    expect(listed[0]).toMatchObject({
      direction: "non_directional",
      label: "ally_of",
    });
  });

  it("keeps both orientations of a directional relationship", async () => {
    const session = await registerAndLogin("rel-directional");
    const projectId = await createProject(
      session.accessToken,
      "Relationship Directional",
    );
    const first = await createCharacter(session.accessToken, projectId, "Aria");
    const second = await createCharacter(session.accessToken, projectId, "Bran");

    const forward = await createRelationship(session.accessToken, projectId, {
      sourceEntityType: "character",
      sourceEntityId: first,
      targetEntityType: "character",
      targetEntityId: second,
      relationType: "influences",
    });
    const backward = await createRelationship(session.accessToken, projectId, {
      sourceEntityType: "character",
      sourceEntityId: second,
      targetEntityType: "character",
      targetEntityId: first,
      relationType: "influences",
    });

    expect(forward.status).toBe(201);
    expect(backward.status).toBe(201);

    const list = await request(
      `/api/v1/projects/${projectId}/characters/${first}/relationships`,
      { accessToken: session.accessToken },
    );
    const relationships = (await readData(list)).relationships as JsonObject[];

    // One row read from each side of the same entity — the outgoing one keeps
    // the stored type, the incoming one flips to the inverse label.
    expect(
      relationships.map((r) => [r.direction, r.label]).sort(),
    ).toEqual([
      ["incoming", "influenced_by"],
      ["outgoing", "influences"],
    ]);
  });

  describe("permissions", () => {
    it("lets an Editor WITHOUT can_delete delete a relationship", async () => {
      // The deliberate difference from every Phase 4-6 content service: the
      // service has `assertCanWrite` with no `assertCanDelete` twin, because
      // cutting a link destroys no content (Flow 4 role matrix, `:17` and
      // `:159`). Copying the Phase 4-6 guard here would have been wrong.
      const owner = await registerAndLogin("rel-owner");
      const editor = await registerAndLogin("rel-editor");
      const projectId = await createProject(owner.accessToken, "Relationship Roles");

      await seedMembership(projectId, editor.userId, "editor", false);

      const characterId = await createCharacter(
        owner.accessToken,
        projectId,
        "Aria",
      );
      const factionId = await createFaction(
        owner.accessToken,
        projectId,
        "Silver Hand",
      );

      const created = await createRelationship(editor.accessToken, projectId, {
        sourceEntityType: "character",
        sourceEntityId: characterId,
        targetEntityType: "faction",
        targetEntityId: factionId,
        relationType: "member_of",
      });

      expect(created.status).toBe(201);
      const relationshipId = (await readData(created)).id as string;

      const deleted = await request(
        `/api/v1/projects/${projectId}/relationships/${relationshipId}`,
        { method: "DELETE", accessToken: editor.accessToken },
      );

      expect(deleted.status).toBe(200);
    });

    it("forbids a Reviewer from writing but not from reading", async () => {
      const owner = await registerAndLogin("rel-owner2");
      const reviewer = await registerAndLogin("rel-reviewer");
      const projectId = await createProject(
        owner.accessToken,
        "Relationship Reviewer",
      );

      await seedMembership(projectId, reviewer.userId, "reviewer", false);

      const characterId = await createCharacter(
        owner.accessToken,
        projectId,
        "Aria",
      );
      const factionId = await createFaction(
        owner.accessToken,
        projectId,
        "Silver Hand",
      );
      const created = await createRelationship(owner.accessToken, projectId, {
        sourceEntityType: "character",
        sourceEntityId: characterId,
        targetEntityType: "faction",
        targetEntityId: factionId,
        relationType: "member_of",
      });

      expect(created.status).toBe(201);
      const relationshipId = (await readData(created)).id as string;
      const basePath = `/api/v1/projects/${projectId}`;

      const reviewerCreate = await createRelationship(
        reviewer.accessToken,
        projectId,
        {
          sourceEntityType: "character",
          sourceEntityId: characterId,
          targetEntityType: "faction",
          targetEntityId: factionId,
          relationType: "ally_of",
        },
      );
      const reviewerPatch = await request(
        `${basePath}/relationships/${relationshipId}`,
        {
          method: "PATCH",
          accessToken: reviewer.accessToken,
          body: { note: "not allowed" },
        },
      );
      const reviewerDelete = await request(
        `${basePath}/relationships/${relationshipId}`,
        { method: "DELETE", accessToken: reviewer.accessToken },
      );

      expect(reviewerCreate.status).toBe(403);
      expect(reviewerPatch.status).toBe(403);
      expect(reviewerDelete.status).toBe(403);

      // Read stays open to every role — membership alone is the gate, and it is
      // enforced upstream by the project-scoped router.
      const reviewerGet = await request(
        `${basePath}/relationships/${relationshipId}`,
        { accessToken: reviewer.accessToken },
      );
      const reviewerList = await request(
        `${basePath}/characters/${characterId}/relationships`,
        { accessToken: reviewer.accessToken },
      );

      expect(reviewerGet.status).toBe(200);
      expect(reviewerList.status).toBe(200);
    });
  });

  describe("rejections that must not become 500s", () => {
    it("answers 400 for an unknown relation type", async () => {
      // The relation type is NOT an enum in Zod on purpose, so this 400 comes
      // from the domain via the service's generic DomainError branch. Without
      // that branch it would reach the client as a raw 500 — the exact bug the
      // 7.1 gate made binding for 7.2.
      const session = await registerAndLogin("rel-unknown-type");
      const projectId = await createProject(session.accessToken, "Relationship 400s");
      const characterId = await createCharacter(
        session.accessToken,
        projectId,
        "Aria",
      );
      const factionId = await createFaction(
        session.accessToken,
        projectId,
        "Silver Hand",
      );

      const response = await createRelationship(session.accessToken, projectId, {
        sourceEntityType: "character",
        sourceEntityId: characterId,
        targetEntityType: "faction",
        targetEntityId: factionId,
        relationType: "befriends",
      });

      expect(response.status).toBe(400);
      expect((await readError(response)).message).toMatch(/Unknown relation type/i);
    });

    it("answers 400 for a pair the registry does not allow", async () => {
      // `member_of` is directional and declared source-first as
      // character -> faction; faction -> character is a different claim, not the
      // same one reversed. Rule 11 (dedicated hierarchy) is covered by the domain
      // unit tests — reaching it over HTTP would need chapters and scenes to
      // prove a 400 that is already proven.
      const session = await registerAndLogin("rel-bad-pair");
      const projectId = await createProject(session.accessToken, "Relationship Pair");
      const characterId = await createCharacter(
        session.accessToken,
        projectId,
        "Aria",
      );
      const factionId = await createFaction(
        session.accessToken,
        projectId,
        "Silver Hand",
      );

      const response = await createRelationship(session.accessToken, projectId, {
        sourceEntityType: "faction",
        sourceEntityId: factionId,
        targetEntityType: "character",
        targetEntityId: characterId,
        relationType: "member_of",
      });

      expect(response.status).toBe(400);
    });

    it("answers 400 for a self-relationship", async () => {
      const session = await registerAndLogin("rel-self");
      const projectId = await createProject(session.accessToken, "Relationship Self");
      const characterId = await createCharacter(
        session.accessToken,
        projectId,
        "Aria",
      );

      const response = await createRelationship(session.accessToken, projectId, {
        sourceEntityType: "character",
        sourceEntityId: characterId,
        targetEntityType: "character",
        targetEntityId: characterId,
        relationType: "ally_of",
      });

      expect(response.status).toBe(400);
    });

    it("answers 400 for a PATCH body with no note key at all", async () => {
      // The deliberate break from Phase 4-6 partial updates: `note` is the only
      // mutable field, so an absent key asks for nothing. Answering 200 would let
      // a misspelled field name pass as success.
      const session = await registerAndLogin("rel-patch-shape");
      const projectId = await createProject(session.accessToken, "Relationship Patch");
      const characterId = await createCharacter(
        session.accessToken,
        projectId,
        "Aria",
      );
      const factionId = await createFaction(
        session.accessToken,
        projectId,
        "Silver Hand",
      );
      const created = await createRelationship(session.accessToken, projectId, {
        sourceEntityType: "character",
        sourceEntityId: characterId,
        targetEntityType: "faction",
        targetEntityId: factionId,
        relationType: "member_of",
      });
      const relationshipId = (await readData(created)).id as string;

      const empty = await request(
        `/api/v1/projects/${projectId}/relationships/${relationshipId}`,
        { method: "PATCH", accessToken: session.accessToken, body: {} },
      );
      const misspelled = await request(
        `/api/v1/projects/${projectId}/relationships/${relationshipId}`,
        {
          method: "PATCH",
          accessToken: session.accessToken,
          body: { notes: "typo" },
        },
      );

      expect(empty.status).toBe(400);
      expect(misspelled.status).toBe(400);
    });
  });

  describe("tenant isolation", () => {
    it("answers 404 when an endpoint entity belongs to another project", async () => {
      const session = await registerAndLogin("rel-cross-entity");
      const projectId = await createProject(session.accessToken, "Relationship Home");
      const otherProjectId = await createProject(
        session.accessToken,
        "Relationship Away",
      );
      const characterId = await createCharacter(
        session.accessToken,
        projectId,
        "Aria",
      );
      const foreignFactionId = await createFaction(
        session.accessToken,
        otherProjectId,
        "Silver Hand",
      );

      const response = await createRelationship(session.accessToken, projectId, {
        sourceEntityType: "character",
        sourceEntityId: characterId,
        targetEntityType: "faction",
        targetEntityId: foreignFactionId,
        relationType: "member_of",
      });

      // Same 404 an entity that does not exist at all would get, and the message
      // names neither condition: otherwise this endpoint becomes an existence
      // oracle for another tenant's content. The caller here is a member of BOTH
      // projects, so the router cannot be what refuses it.
      expect(response.status).toBe(404);
      expect((await readError(response)).message).toMatch(/entity not found/i);
    });

    it("answers 404 for a relationship id that belongs to another project", async () => {
      const session = await registerAndLogin("rel-cross-id");
      const projectId = await createProject(session.accessToken, "Relationship Own");
      const otherProjectId = await createProject(
        session.accessToken,
        "Relationship Other",
      );
      const characterId = await createCharacter(
        session.accessToken,
        otherProjectId,
        "Aria",
      );
      const factionId = await createFaction(
        session.accessToken,
        otherProjectId,
        "Silver Hand",
      );
      const created = await createRelationship(
        session.accessToken,
        otherProjectId,
        {
          sourceEntityType: "character",
          sourceEntityId: characterId,
          targetEntityType: "faction",
          targetEntityId: factionId,
          relationType: "member_of",
        },
      );

      expect(created.status).toBe(201);
      const relationshipId = (await readData(created)).id as string;

      // `findById` is not project-scoped by design; the service compares the
      // project itself. All three verbs must agree — a guard on the read path
      // alone would leave the write paths addressable across tenants.
      const basePath = `/api/v1/projects/${projectId}/relationships/${relationshipId}`;
      const fetched = await request(basePath, {
        accessToken: session.accessToken,
      });
      const patched = await request(basePath, {
        method: "PATCH",
        accessToken: session.accessToken,
        body: { note: "not mine" },
      });
      const deleted = await request(basePath, {
        method: "DELETE",
        accessToken: session.accessToken,
      });

      expect([fetched.status, patched.status, deleted.status]).toEqual([
        404, 404, 404,
      ]);
    });
  });

  // Item 7.4b — the M:N half of Flow 3 §Delete step 5, over HTTP against the
  // real database. This is the only rule in the content domain that no database
  // constraint can enforce: `content_relationships` names its endpoints
  // polymorphically, with no foreign key, so before this guard every delete of a
  // linked entity succeeded and left an orphan row behind.
  describe("content delete blocked by an M:N relationship", () => {
    it("refuses from either endpoint, names the blocker, writes nothing, and lets the delete through once the relationship is gone", async () => {
      const session = await registerAndLogin("rel-guard");
      const projectId = await createProject(session.accessToken, "Delete Guard");
      const basePath = `/api/v1/projects/${projectId}`;
      const characterId = await createCharacter(
        session.accessToken,
        projectId,
        "Kael of Vael",
      );
      const factionId = await createFaction(
        session.accessToken,
        projectId,
        "The Silver Hand",
      );

      const created = await createRelationship(session.accessToken, projectId, {
        sourceEntityType: "character",
        sourceEntityId: characterId,
        targetEntityType: "faction",
        targetEntityId: factionId,
        relationType: "member_of",
      });

      expect(created.status).toBe(201);
      const relationshipId = (await readData(created)).id as string;

      const blockedCharacter = await request(
        `${basePath}/characters/${characterId}`,
        { method: "DELETE", accessToken: session.accessToken },
      );

      expect(blockedCharacter.status).toBe(409);
      // The names come from the descriptor table, resolved AFTER the transaction
      // rolled back — the whole reason 7.4b took a locator rather than answering
      // with bare ids.
      expect(await readError(blockedCharacter)).toMatchObject({
        code: "CONFLICT",
        message:
          "Character is still linked to 1 content relationship and cannot be deleted",
        details: {
          blockingRelationshipCount: 1,
          truncated: false,
          blockingRelationships: [
            {
              id: relationshipId,
              relationType: "member_of",
              entityType: "faction",
              entityId: factionId,
              entityName: "The Silver Hand",
            },
          ],
        },
      });

      // The same row blocks from the other end, and the payload flips with it:
      // the character is the counterpart when the faction is the one deleted.
      // A guard written only for the source side would let this delete through.
      const blockedFaction = await request(`${basePath}/factions/${factionId}`, {
        method: "DELETE",
        accessToken: session.accessToken,
      });

      expect(blockedFaction.status).toBe(409);
      expect(await readError(blockedFaction)).toMatchObject({
        message:
          "Faction is still linked to 1 content relationship and cannot be deleted",
        details: {
          blockingRelationships: [
            {
              entityType: "character",
              entityId: characterId,
              entityName: "Kael of Vael",
            },
          ],
        },
      });

      // Neither refusal wrote anything. Read from the database rather than
      // inferred from the 409: the guard shares a transaction with the revision
      // insert, the outbox insert and the hard delete, and a guard that fired
      // after them would leave an audit trail claiming a deletion that never
      // happened plus an outbox event telling the worker to drop live vectors.
      expect(
        await prisma.contentRevision.count({
          where: { projectId, changeType: "delete" },
        }),
      ).toBe(0);
      expect(
        await prisma.outboxEvent.count({
          where: {
            eventType: "content.deleted",
            aggregateId: { in: [characterId, factionId] },
          },
        }),
      ).toBe(0);

      const stillThere = await request(
        `${basePath}/characters/${characterId}`,
        { accessToken: session.accessToken },
      );

      expect(stillThere.status).toBe(200);

      // And the positive half: unlink, and the same delete goes through. Without
      // this, a guard that refused every delete would pass just as happily.
      const unlinked = await request(
        `${basePath}/relationships/${relationshipId}`,
        { method: "DELETE", accessToken: session.accessToken },
      );

      expect(unlinked.status).toBe(200);

      const deletedCharacter = await request(
        `${basePath}/characters/${characterId}`,
        { method: "DELETE", accessToken: session.accessToken },
      );

      expect(deletedCharacter.status).toBe(200);
      expect(
        await prisma.contentRevision.count({
          where: { projectId, changeType: "delete" },
        }),
      ).toBe(1);
    });
  });
});
