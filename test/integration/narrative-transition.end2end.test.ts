import { once } from "node:events";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createAppContainer } from "../../src/infrastructure/container.js";
import { deleteEvaluationFold } from "../helpers/foldCleanup.js";
import { seedProjectVocabulary } from "../helpers/relationshipVocabulary.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Item 7.9. What every layer below could NOT prove, proved here against a real
// Postgres over real HTTP:
//
//   1. The nine-slot write dispatch actually writes — and for a SECOND entity
//      type, not just `character` (the only slot 7.7's unit tests executed).
//   2. The wire→domain field name mapping (`event_type` -> `eventType`) is real
//      rather than asserted against a fake.
//   3. `FOR UPDATE` + the re-check under the lock behave as an idempotency
//      guard under genuine concurrency. 7.7 could only assert that the SQL text
//      contains `FOR UPDATE`.
//   4. Bulk apply is all-or-nothing: a failure on the second effect rolls the
//      first one back in the database, not merely in intent.
//   5. The two binding requirements the 7.8 gate attached to this file: declare
//      with `reversesTransitionId` filled and read the COLUMN back, and lock the
//      NEW `addEffect` message ("Target entity not found").
//
// Fixtures are created through the API with server-minted ids, so this file
// claims no fixture id block — the 016 convention exists for files that hardcode
// uuids (`content-relationship-repository.integration.test.ts:39-53`), and there
// is nothing here to collide with.

const EMAIL_SUFFIX = "@narrative-transition-e2e.test";

// Every username this file mints is prefixed `nt-`, and that is not cosmetic:
// `users.username` is UNIQUE across the whole database while this file's cleanup
// keys on the email suffix, so the two namespaces do not line up. A plain
// "writer" here made `user-repository.integration.test.ts` fail intermittently —
// its `findByUsername("writer")` returned THIS file's user when the two ran
// together, and the suite still went green on the next run. Same failure class
// as the fixture id blocks (`content-relationship-repository.integration.test.ts:39-53`),
// one namespace over: grep `registerAndLogin("` across `test/integration/`
// before adding a name.
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
    "x-request-id": `narrative-transition-e2e-${crypto.randomUUID()}`,
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

async function createProject(
  accessToken: string,
  name: string,
): Promise<string> {
  const response = await request("/api/v1/projects", {
    method: "POST",
    accessToken,
    body: { name },
  });

  expect(response.status).toBe(201);

  return (await readData(response)).projectId as string;
}

async function createEntity(
  accessToken: string,
  projectId: string,
  segment: string,
  body: JsonObject,
  idField: string,
): Promise<string> {
  const response = await request(
    `/api/v1/projects/${projectId}/${segment}`,
    { method: "POST", accessToken, body },
  );

  expect(response.status, `create ${segment}`).toBe(201);

  return (await readData(response))[idField] as string;
}

function createCharacter(
  accessToken: string,
  projectId: string,
  name: string,
): Promise<string> {
  return createEntity(
    accessToken,
    projectId,
    "characters",
    {
      name,
      archetype: "mentor",
      background: "Left the academy after the second siege",
      personality: "Patient, and slow to name her reasons",
      description: "A wandering sage",
    },
    "characterId",
  );
}

function createFaction(
  accessToken: string,
  projectId: string,
  name: string,
): Promise<string> {
  return createEntity(
    accessToken,
    projectId,
    "factions",
    { name, description: "A knightly order", background: "Founded after the war" },
    "factionId",
  );
}

function createEvent(
  accessToken: string,
  projectId: string,
  title: string,
): Promise<string> {
  return createEntity(
    accessToken,
    projectId,
    "events",
    { title, era: "First Age", eventType: "historical" },
    "eventId",
  );
}

function createChapter(
  accessToken: string,
  projectId: string,
  title: string,
): Promise<string> {
  return createEntity(
    accessToken,
    projectId,
    "chapters",
    { title, order: 1 },
    "chapterId",
  );
}

async function createScene(
  accessToken: string,
  projectId: string,
  chapterId: string,
): Promise<string> {
  const response = await request(
    `/api/v1/projects/${projectId}/chapters/${chapterId}/scenes`,
    { method: "POST", accessToken, body: { orderInChapter: 0 } },
  );

  expect(response.status).toBe(201);

  return (await readData(response)).sceneId as string;
}

// Seeded straight into `user_projects`: there is no invitation API yet (Phase
// 12) and a project creator is always writer + canDelete, so no other point of
// the permission matrix is reachable over HTTP. Mirrors the helper of the same
// name in content-relationship.end2end.test.ts.
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

function transitionsPath(projectId: string): string {
  return `/api/v1/projects/${projectId}/narrative-transitions`;
}

function effectsPath(projectId: string): string {
  return `/api/v1/projects/${projectId}/transition-effects`;
}

async function declareTransition(
  accessToken: string,
  projectId: string,
  body: JsonObject,
): Promise<JsonObject> {
  const response = await request(transitionsPath(projectId), {
    method: "POST",
    accessToken,
    body,
  });

  expect(response.status, "declare").toBe(201);

  return readData(response);
}

async function addEffect(
  accessToken: string,
  projectId: string,
  transitionId: string,
  body: JsonObject,
): Promise<JsonObject> {
  const response = await request(
    `${transitionsPath(projectId)}/${transitionId}/effects`,
    { method: "POST", accessToken, body },
  );

  expect(response.status, "add effect").toBe(201);

  return readData(response);
}

function applyEffect(
  accessToken: string,
  projectId: string,
  effectId: string,
): Promise<Response> {
  return request(`${effectsPath(projectId)}/${effectId}/apply`, {
    method: "POST",
    accessToken,
  });
}

function countRevisions(entityId: string): Promise<number> {
  return prisma.contentRevision.count({ where: { entityId } });
}

// One writer, one project, one scene to hang transitions off, and the two
// entities every effect below acts on.
type Fixture = {
  accessToken: string;
  userId: string;
  projectId: string;
  sceneId: string;
  chapterId: string;
  characterId: string;
  factionId: string;
};

async function seedFixture(name = "nt-writer"): Promise<Fixture> {
  const { accessToken, userId } = await registerAndLogin(name);
  const projectId = await createProject(accessToken, `${name} project`);

  // Relationship effects write `content_relationships`, which references the
  // project's predicate vocabulary by composite foreign key since step 4.
  await seedProjectVocabulary(prisma, projectId);
  const chapterId = await createChapter(accessToken, projectId, "Chapter One");
  const sceneId = await createScene(accessToken, projectId, chapterId);
  const characterId = await createCharacter(accessToken, projectId, "Aria");
  const factionId = await createFaction(accessToken, projectId, "Silver Hand");

  return {
    accessToken,
    userId,
    projectId,
    sceneId,
    chapterId,
    characterId,
    factionId,
  };
}

beforeAll(async () => {
  process.env.JWT_SECRET = "narrative-transition-e2e-test-secret";

  const container = createAppContainer();
  const app = createApp(container);
  prisma = container.resolve("prisma");
  server = serve({ fetch: app.fetch, port: 0 });

  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Narrative transition E2E server did not expose a TCP port");
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
    // Children before parents throughout: `content_relationships` ->
    // `transition_effects` -> `narrative_transitions` -> `projects` is a chain of
    // onDelete: Restrict, so one surviving row at any level fails the project
    // delete rather than cascading, and the failure would surface inside an
    // unrelated test.
    //
    // FOUR levels since step 4b-2, and the projection moved to the FRONT: it
    // references the assertion it was folded from
    // (`content_relationships.source_assertion_id`), so deleting assertions first
    // now fails. That ordering was correct for three years' worth of reasons and
    // is simply wrong now — the kind of breakage no compiler sees.
    await prisma.contentRelationship.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await deleteEvaluationFold(prisma, projectIds);
    await prisma.transitionEffect.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.narrativeTransition.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.scene.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.chapter.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.event.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.character.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.faction.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.contentRevision.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    // Not FK-bound to the project, but apply writes one row per applied effect
    // and the assertions below count them; leftovers from a previous run would
    // make those counts meaningless.
    await prisma.outboxEvent.deleteMany({
      where: { projectId: { in: projectIds } },
    });
  }

  await prisma.userProject.deleteMany({ where: { userId: { in: userIds } } });
  // FOUR levels since step 4b-2, in this order: the projection points at the
  // assertion it was folded from, the assertion points at the predicate
  // definition, the definition belongs to the project — every link
  // onDelete: Restrict. The block above already cleared the first two for the
  // projects it found; these repeat it so this teardown stands on its own rather
  // than depending on which branch ran.
  await prisma.contentRelationship.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await deleteEvaluationFold(prisma, projectIds);
  await prisma.transitionEffect.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  // Predicate vocabulary before the project: `relationship_definitions` is
  // onDelete: Restrict, so a project still holding its vocabulary refuses to be
  // deleted. Consequence of step 4, and the reason this belongs in a cleanup
  // helper rather than in each test.
  await prisma.relationshipDefinition.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await prisma.project.deleteMany({ where: { ownerUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

afterAll(async () => {
  // The outbox rows this file produced are dropped as soon as it finishes rather
  // than at the next run's `beforeEach`. They are `pending` and
  // `OutboxDispatcher.claimDueEvents()` claims GLOBALLY by design, so every row
  // left lying here is work another file's real dispatcher may pick up while it
  // is still running — and that contention is the documented cause of the rare
  // `outbox-dispatcher.smoke.test.ts` flake (its own header, `:30-42`). This
  // does not fix that flake, which predates 7.9 and belongs to the shared table
  // rather than to any one file; it just stops this file from feeding it.
  const users = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX } },
    select: { id: true },
  });

  if (users.length > 0) {
    const projects = await prisma.project.findMany({
      where: { ownerUserId: { in: users.map((user) => user.id) } },
      select: { id: true },
    });

    if (projects.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { projectId: { in: projects.map((project) => project.id) } },
      });
    }
  }

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

describe("Narrative transition end-to-end", () => {
  it("round-trips declare, read, list, relabel and apply, and writes the entity for real", async () => {
    const fixture = await seedFixture();
    const { accessToken, projectId, sceneId, characterId } = fixture;

    const declared = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "The duel at the bridge",
      description: "Aria loses her standing",
    });

    const transitionId = declared.id as string;

    expect(declared).toMatchObject({
      projectId,
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "The duel at the bridge",
      declaredByUserId: fixture.userId,
      reversesTransitionId: null,
      // Born with no effects, so `declared` — the empty set is NOT vacuously
      // "fully applied" (`NarrativeTransition.ts:47-49`).
      status: "declared",
      effects: [],
    });

    const effect = await addEffect(accessToken, projectId, transitionId, {
      effectType: "attribute_change",
      targetEntityType: "character",
      targetEntityId: characterId,
      fieldPath: "archetype",
      newValue: "fallen hero",
    });

    expect(effect).toMatchObject({
      narrativeTransitionId: transitionId,
      effectType: "attribute_change",
      fieldPath: "archetype",
      newValue: "fallen hero",
      appliedAt: null,
      contentRevisionId: null,
      relationshipType: null,
    });

    const afterAdd = await readData(
      await request(`${transitionsPath(projectId)}/${transitionId}`, {
        accessToken,
      }),
    );
    expect(afterAdd.status).toBe("declared");
    expect((afterAdd.effects as JsonObject[]).length).toBe(1);

    // Relabel: the one mutable pair, and `updated_at` is expected to move.
    const relabelled = await readData(
      await request(`${transitionsPath(projectId)}/${transitionId}`, {
        method: "PATCH",
        accessToken,
        body: { title: "The duel at the bridge, revised", description: null },
      }),
    );
    expect(relabelled).toMatchObject({
      title: "The duel at the bridge, revised",
      description: null,
    });

    const revisionsBefore = await countRevisions(characterId);

    const applyResponse = await applyEffect(
      accessToken,
      projectId,
      effect.id as string,
    );
    expect(applyResponse.status).toBe(200);
    const applied = await readData(applyResponse);

    expect(applied.appliedAt).not.toBeNull();
    expect(applied.contentRevisionId).not.toBeNull();

    // The entity itself, read from the database rather than from the response
    // that claimed to have changed it.
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    });
    expect(character?.archetype).toBe("fallen hero");

    // Exactly one new revision, and it is the one the effect points at.
    expect(await countRevisions(characterId)).toBe(revisionsBefore + 1);
    const revision = await prisma.contentRevision.findUnique({
      where: { id: applied.contentRevisionId as string },
    });
    expect(revision?.entityType).toBe("character");
    expect(revision?.entityId).toBe(characterId);

    // D6: an attribute change must emit `content.updated` for the TARGET
    // entity, or Qdrant goes stale.
    const outbox = await prisma.outboxEvent.findMany({
      where: { projectId, aggregateId: characterId },
      select: { eventType: true, aggregateType: true },
    });
    expect(outbox).toContainEqual({
      eventType: "content.updated",
      aggregateType: "character",
    });

    const afterApply = await readData(
      await request(`${transitionsPath(projectId)}/${transitionId}`, {
        accessToken,
      }),
    );
    expect(afterApply.status).toBe("fully_applied");

    // Both list shapes carry the effects, because status cannot be read without
    // them (D11).
    const byProject = await readData(
      await request(transitionsPath(projectId), { accessToken }),
    );
    const listed = byProject.narrativeTransitions as JsonObject[];
    expect(listed).toHaveLength(1);
    expect((listed[0]?.effects as JsonObject[]).length).toBe(1);

    const bySource = await readData(
      await request(
        `/api/v1/projects/${projectId}/scenes/${sceneId}/narrative-transitions`,
        { accessToken },
      ),
    );
    expect((bySource.narrativeTransitions as JsonObject[])[0]?.id).toBe(
      transitionId,
    );
  });

  // Binding requirement (1) from the 7.8 gate. The mapper line that carries this
  // pointer could be deleted with the whole interface suite green, and a lost
  // pointer turns a reversal into an ordinary transition: causality severed,
  // nothing raised. So the column is read back from Postgres, not from the
  // response that would echo whatever the mapper produced.
  it("stores the reversal pointer in the column, not just in the response", async () => {
    const { accessToken, projectId, sceneId, characterId } = await seedFixture();

    const original = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "The duel at the bridge",
    });

    // A transition that has not happened cannot be undone: reversing a
    // `declared` one is a 409 (`NarrativeTransitionService.ts:997-1001`). So the
    // original is applied first — which is also the only shape in which a
    // reversal means anything.
    const originalEffect = await addEffect(
      accessToken,
      projectId,
      original.id as string,
      {
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: characterId,
        fieldPath: "archetype",
        newValue: "fallen hero",
      },
    );
    expect(
      (await applyEffect(accessToken, projectId, originalEffect.id as string))
        .status,
    ).toBe(200);

    const reversal = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "The duel undone",
      reversesTransitionId: original.id,
    });

    expect(reversal.reversesTransitionId).toBe(original.id);

    const stored = await prisma.narrativeTransition.findUnique({
      where: { id: reversal.id as string },
      select: { reversesTransitionId: true },
    });
    expect(stored?.reversesTransitionId).toBe(original.id);

    const reread = await readData(
      await request(`${transitionsPath(projectId)}/${reversal.id as string}`, {
        accessToken,
      }),
    );
    expect(reread.reversesTransitionId).toBe(original.id);
  });

  // The rule the test above had to satisfy, locked in its own right: an undo of
  // something that never happened is not a reversal, it is a fiction, and
  // append-only exists so that the graph never records one.
  it("refuses to reverse a transition that has not been applied", async () => {
    const { accessToken, projectId, sceneId } = await seedFixture();

    const original = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "Nothing has happened yet",
    });

    const response = await request(transitionsPath(projectId), {
      method: "POST",
      accessToken,
      body: {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Undoing nothing",
        reversesTransitionId: original.id,
      },
    });

    expect(response.status).toBe(409);
    expect(await readError(response)).toMatchObject({
      message: "Only an applied or partially applied transition can be reversed",
    });
  });

  // The other half of item 7.9's "reversal flow" clause, and the half that
  // carries the meaning: undoing is defined as declaring an inverse transition
  // and APPLYING it through the same path, never as retracting the old artefacts
  // (`05-implementation-policy/05_append_only_invariants.md:60-64`). Until this
  // test existed, everything proven about reversal stopped at declaration —
  // "a reversal can be declared", not "undoing works".
  //
  // The second assertion is the one that will matter later: `applyOneEffect`
  // does not read `reversesTransitionId` at all, so applying a reversal is an
  // ordinary apply and no mutant of TODAY's code can break it alone. What it
  // guards is the "helpful" change of tomorrow — the one that decides an undo
  // should also clear the original's `applied_at`. That is precisely the silent
  // deletion `:80-85` says makes the Phase 11 evaluation graph stale.
  it("applies a reversal as a new forward fact and leaves the original applied", async () => {
    const { accessToken, projectId, sceneId, characterId, factionId } =
      await seedFixture();

    const original = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "Aria joins the Silver Hand",
    });
    const originalEffect = await addEffect(
      accessToken,
      projectId,
      original.id as string,
      {
        effectType: "relationship_add",
        targetEntityType: "character",
        targetEntityId: characterId,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: factionId,
      },
    );
    const appliedOriginal = await readData(
      await applyEffect(accessToken, projectId, originalEffect.id as string),
    );
    expect(
      await prisma.contentRelationship.count({ where: { projectId } }),
    ).toBe(1);

    const reversal = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "Aria leaves the Silver Hand",
      reversesTransitionId: original.id,
    });
    const inverse = await addEffect(
      accessToken,
      projectId,
      reversal.id as string,
      {
        effectType: "relationship_remove",
        targetEntityType: "character",
        targetEntityId: characterId,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: factionId,
      },
    );

    expect(
      (await applyEffect(accessToken, projectId, inverse.id as string)).status,
    ).toBe(200);

    // 1. The world is back where it started, read from the table rather than
    //    inferred from a 200.
    expect(
      await prisma.contentRelationship.count({ where: { projectId } }),
    ).toBe(0);

    // 2. The original is untouched: same `applied_at`, still fully applied. A
    //    reversal ADDS a fact; it does not retract one.
    const originalRow = await prisma.transitionEffect.findUnique({
      where: { id: originalEffect.id as string },
      select: { appliedAt: true },
    });
    expect(originalRow?.appliedAt?.toISOString()).toBe(
      appliedOriginal.appliedAt,
    );

    const originalAfter = await readData(
      await request(`${transitionsPath(projectId)}/${original.id as string}`, {
        accessToken,
      }),
    );
    expect(originalAfter.status).toBe("fully_applied");

    // 3. The reversal published its OWN forward event, and the original's event
    //    is still there — two causes on the graph, not one cause deleted
    //    (`05_append_only_invariants.md:80-85`).
    expect(
      await prisma.outboxEvent.findMany({
        where: { projectId, aggregateId: reversal.id as string },
        select: { eventType: true, aggregateType: true },
      }),
    ).toEqual([
      {
        eventType: "narrative.effect.applied",
        aggregateType: "narrative_transition",
      },
    ]);
    expect(
      await prisma.outboxEvent.count({
        where: {
          projectId,
          aggregateId: original.id as string,
          eventType: "narrative.effect.applied",
        },
      }),
    ).toBe(1);
  });

  // All three nested source routes, each answering with its OWN transition and
  // nothing else. The route table's segment→source-type pairing is already
  // locked by a unit test, but only at the wiring level: this is what proves the
  // SERVICE accepts a chapter and an event as causes — `assertEntityInProject`
  // resolves each through `ContentEntityLocator`, and a locator that could not
  // find a chapter would fail here and nowhere else.
  it("lists transitions from each of the three nested source routes", async () => {
    const { accessToken, projectId, sceneId, chapterId } = await seedFixture();
    const eventId = await createEvent(accessToken, projectId, "The Sundering");

    const sources: Array<[string, string, string]> = [
      ["scene", sceneId, "scenes"],
      ["event", eventId, "events"],
      ["chapter", chapterId, "chapters"],
    ];

    const declaredIds = new Map<string, string>();

    for (const [sourceEntityType, sourceEntityId] of sources) {
      const declared = await declareTransition(accessToken, projectId, {
        sourceEntityType,
        sourceEntityId,
        title: `Declared from a ${sourceEntityType}`,
      });

      declaredIds.set(sourceEntityType, declared.id as string);
    }

    for (const [sourceEntityType, sourceEntityId, segment] of sources) {
      const listed = await readData(
        await request(
          `/api/v1/projects/${projectId}/${segment}/${sourceEntityId}/narrative-transitions`,
          { accessToken },
        ),
      );

      // Exactly its own, not all three: the nested list is scoped by the entity
      // in the path, and a route wired to the wrong source type would return
      // someone else's or an empty list that looks plausible.
      expect(
        (listed.narrativeTransitions as JsonObject[]).map((row) => row.id),
        `${segment} nested list`,
      ).toEqual([declaredIds.get(sourceEntityType)]);
    }
  });

  // The second dispatch slot to be EXECUTED rather than name-checked (§10 risk),
  // and the only place the snake_case wire name is proved to reach the
  // camelCase domain field: `event_type` -> `eventType`.
  it("applies an attribute change to a second entity type and maps the wire field name", async () => {
    const { accessToken, projectId, sceneId } = await seedFixture();
    const eventId = await createEvent(accessToken, projectId, "The Sundering");

    const transition = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "The Sundering is reclassified",
    });

    const effect = await addEffect(
      accessToken,
      projectId,
      transition.id as string,
      {
        effectType: "attribute_change",
        targetEntityType: "event",
        targetEntityId: eventId,
        fieldPath: "event_type",
        newValue: "mythical",
      },
    );

    const response = await applyEffect(
      accessToken,
      projectId,
      effect.id as string,
    );
    expect(response.status).toBe(200);

    const stored = await prisma.event.findUnique({ where: { id: eventId } });
    expect(stored?.eventType).toBe("mythical");
  });

  it("applies relationship effects through the transition path and emits a causality event", async () => {
    const { accessToken, projectId, sceneId, characterId, factionId } =
      await seedFixture();

    const transition = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "Aria joins the Silver Hand",
    });

    const addEffectRow = await addEffect(
      accessToken,
      projectId,
      transition.id as string,
      {
        effectType: "relationship_add",
        targetEntityType: "character",
        targetEntityId: characterId,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: factionId,
      },
    );

    const applied = await readData(
      await applyEffect(accessToken, projectId, addEffectRow.id as string),
    );

    // A relationship change produces NO ContentRevision — nothing's text moved
    // (`16:105`) — so the pointer must stay null while `appliedAt` is set.
    expect(applied.appliedAt).not.toBeNull();
    expect(applied.contentRevisionId).toBeNull();

    const relationships = (
      (await readData(
        await request(
          `/api/v1/projects/${projectId}/characters/${characterId}/relationships`,
          { accessToken },
        ),
      )).relationships as JsonObject[]
    ).map((row) => row.relationType);
    expect(relationships).toEqual(["member_of"]);

    // D6: the causality event, aggregated on the TRANSITION, not `content.updated`
    // — the graph consumer of Phase 11 needs the cause, and no text was reindexed.
    const outbox = await prisma.outboxEvent.findMany({
      where: { projectId, aggregateId: transition.id as string },
      select: { eventType: true, aggregateType: true, payload: true },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe("narrative.effect.applied");
    expect(outbox[0]?.aggregateType).toBe("narrative_transition");

    // 4b-3 / F-1: the event reports what reached the LOG, not only what was declared.
    // On this path the effect row IS the assertion, and the payload says so rather
    // than leaving a consumer to know that.
    expect(outbox[0]?.payload).toMatchObject({
      effectType: "relationship_add",
      assertionId: addEffectRow.id,
      terminationId: null,
      targetAssertionId: null,
      anchorEntityType: null,
      anchorEntityId: null,
    });

    // And the removal path, on a second transition: the row must be gone.
    const removal = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "Aria leaves the Silver Hand",
    });
    const removeEffect = await addEffect(
      accessToken,
      projectId,
      removal.id as string,
      {
        effectType: "relationship_remove",
        targetEntityType: "character",
        targetEntityId: characterId,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: factionId,
      },
    );

    expect(
      (await applyEffect(accessToken, projectId, removeEffect.id as string))
        .status,
    ).toBe(200);

    // ── STEP 4b-3 CLOSES THE WINDOW THIS ASSERTION USED TO HIDE ─────────────
    //
    // Until 4b-3 the count below was the WHOLE claim here: the projection row was
    // deleted and nothing was written to the log, so the `relationship_add` stayed
    // applied and unwithdrawn (gerbang G1, T-6). Rebuilding the projection from the log
    // — what `GraphProjector` does at 4b-4 — would have resurrected this relationship.
    //
    // Both halves are asserted now, because either alone is satisfiable by a bug: the
    // fold is gone AND the log says why it is gone.
    expect(
      await prisma.contentRelationship.count({
        where: { projectId, relationType: "member_of" },
      }),
    ).toBe(0);

    const termination = await prisma.transitionEffect.findFirstOrThrow({
      where: { projectId, effectType: "terminate" },
      select: {
        id: true,
        targetAssertionId: true,
        targetEffectType: true,
        anchorEntityType: true,
        anchorEntityId: true,
        narrativeTransitionId: true,
        appliedAt: true,
      },
    });

    // It names the fact it ends — the effect row of the FIRST transition, which is the
    // assertion on this path.
    expect(termination.targetAssertionId).toBe(addEffectRow.id);
    expect(termination.targetEffectType).toBe("relationship_add");
    // And the story moment it ends at: the scene the removing transition was declared
    // on. A `retract` would carry no anchor at all — that difference is the whole
    // reason the two operations exist (premis §8.3).
    expect(termination.anchorEntityType).toBe("scene");
    expect(termination.anchorEntityId).toBe(sceneId);
    expect(termination.narrativeTransitionId).toBe(removal.id);
    expect(termination.appliedAt).not.toBeNull();

    // The claim itself survives, still applied: this is a log, so an ending is a new
    // row rather than an edit of the old one.
    const asserted = await prisma.transitionEffect.findFirstOrThrow({
      where: { id: addEffectRow.id as string },
      select: { effectType: true, appliedAt: true },
    });

    expect(asserted.effectType).toBe("relationship_add");
    expect(asserted.appliedAt).not.toBeNull();

    // ── F-1 (gerbang 4b-3): the causality event must report the row it WROTE ──
    //
    // Before this, the removal's event carried `effectType: "relationship_remove"`
    // and the declared effect's id, and nothing else — a consumer could not learn
    // that a `terminate` row existed at all, let alone the story moment it carries.
    // `evaluation_edges` is a valid-time fold (premis §8.4), so that moment is not
    // decoration: it is the whole "when".
    const removalEvent = await prisma.outboxEvent.findFirstOrThrow({
      where: { projectId, aggregateId: removal.id as string },
      select: { payload: true },
    });

    expect(removalEvent.payload).toMatchObject({
      effectType: "relationship_remove",
      // The rows written, not the intent: the terminate row and the assertion it ends.
      terminationId: termination.id,
      targetAssertionId: addEffectRow.id,
      // And the story moment, carried so the projector can fold valid-time without a
      // second read.
      anchorEntityType: "scene",
      anchorEntityId: sceneId,
      assertionId: null,
    });

    // THE COPY IS PINNED TO THE ROW. The anchor now lives in two places — the
    // `terminate` row (authoritative) and this payload (convenience) — and this is the
    // assertion that stops them drifting apart in silence.
    expect(removalEvent.payload).toMatchObject({
      anchorEntityType: termination.anchorEntityType,
      anchorEntityId: termination.anchorEntityId,
    });
  });

  // DECIDED 2026-08-19 — blokir gerbang G1 (T-2 + A-3). End to end, over HTTP,
  // because the hole was end to end: the CRUD button and the narrative path meet
  // only in the database, and a unit test with a fake repository cannot show that
  // the projection row jalur 7.7 wrote is reachable by
  // `DELETE /projects/:projectId/relationships/:relationshipId`.
  it("refuses a CRUD delete of a relationship a narrative transition asserted", async () => {
    const { accessToken, projectId, sceneId, characterId, factionId } =
      await seedFixture("nt-crud-guard");

    const transition = await declareTransition(accessToken, projectId, {
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
      title: "Aria joins the Silver Hand",
    });
    const effect = await addEffect(
      accessToken,
      projectId,
      transition.id as string,
      {
        effectType: "relationship_add",
        targetEntityType: "character",
        targetEntityId: characterId,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: factionId,
      },
    );

    expect(
      (await applyEffect(accessToken, projectId, effect.id as string)).status,
    ).toBe(200);

    // Read straight from the projection rather than through the list DTO: what
    // matters here is the row's identity and its `source_assertion_id`, not how the
    // API renders it.
    const projected = await prisma.contentRelationship.findFirstOrThrow({
      where: { projectId, relationType: "member_of" },
      select: { id: true, sourceAssertionId: true },
    });

    // The premise of the whole finding, asserted so the test explains itself if the
    // wiring ever changes: on this path the EFFECT ROW is the assertion.
    expect(projected.sourceAssertionId).toBe(effect.id);

    const refused = await request(
      `/api/v1/projects/${projectId}/relationships/${projected.id}`,
      { method: "DELETE", accessToken },
    );

    expect(refused.status).toBe(409);
    expect((await readError(refused)).message).toMatch(/narrative transition/i);

    // Nothing moved. The projection survives, and — the assertion that actually
    // separates "refused" from "half-done" — no `retract` row was written and the
    // transition's own effect is still applied.
    expect(
      await prisma.contentRelationship.count({
        where: { projectId, relationType: "member_of" },
      }),
    ).toBe(1);
    expect(
      await prisma.transitionEffect.count({
        where: { projectId, effectType: "retract" },
      }),
    ).toBe(0);
    const stillApplied = await prisma.transitionEffect.findFirstOrThrow({
      where: { id: effect.id as string },
      select: { appliedAt: true, narrativeTransitionId: true },
    });
    expect(stillApplied.appliedAt).not.toBeNull();
    expect(stillApplied.narrativeTransitionId).toBe(transition.id);
  });

  describe("idempotency and concurrency, against real row locks", () => {
    it("answers the second apply with the same applied effect and writes one revision", async () => {
      const { accessToken, projectId, sceneId, characterId } =
        await seedFixture();

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Aria falls",
      });
      const effect = await addEffect(
        accessToken,
        projectId,
        transition.id as string,
        {
          effectType: "attribute_change",
          targetEntityType: "character",
          targetEntityId: characterId,
          fieldPath: "archetype",
          newValue: "fallen hero",
        },
      );

      const before = await countRevisions(characterId);
      const first = await readData(
        await applyEffect(accessToken, projectId, effect.id as string),
      );
      const secondResponse = await applyEffect(
        accessToken,
        projectId,
        effect.id as string,
      );

      expect(secondResponse.status).toBe(200);
      const second = await readData(secondResponse);

      // Identical `applied_at`, so the second call did not re-apply and then
      // re-stamp — append-only means this column moves once
      // (`05_append_only_invariants.md:52-64`).
      expect(second.appliedAt).toBe(first.appliedAt);
      expect(second.contentRevisionId).toBe(first.contentRevisionId);
      expect(await countRevisions(characterId)).toBe(before + 1);
    });

    // Two applies dispatched together produce ONE mutation, against real
    // Postgres. What this does and does not prove, measured rather than assumed:
    //
    //   PROVEN — the idempotent outcome end to end. Deleting the re-check under
    //   the lock (`applyOneEffect`) turns this test AND the bulk-apply
    //   idempotency test red.
    //
    //   NOT PROVEN — that `FOR UPDATE` on the READ is what saves it. Deleting
    //   the clause leaves all 20 tests green: over HTTP the second request's
    //   read almost always lands after the first has committed, so the
    //   interleaving that needs the read lock never occurs. Forcing it would
    //   need a pause between the service's read and its write, which no test
    //   seam offers; holding the row lock from outside does not discriminate
    //   either, because the UPDATE would block on it even with the read
    //   unlocked. The clause keeps two compensating controls instead: the unit
    //   assertion that the statement text carries it
    //   (`PrismaTransitionEffectRepository.test.ts:128`) and the reasoning at
    //   `flow_10:101,115`. Recorded as a limit, not papered over.
    it("survives two concurrent applies of the same effect with a single revision", async () => {
      const { accessToken, projectId, sceneId, characterId } =
        await seedFixture();

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Aria falls, twice at once",
      });
      const effect = await addEffect(
        accessToken,
        projectId,
        transition.id as string,
        {
          effectType: "attribute_change",
          targetEntityType: "character",
          targetEntityId: characterId,
          fieldPath: "archetype",
          newValue: "fallen hero",
        },
      );

      const before = await countRevisions(characterId);

      const [left, right] = await Promise.all([
        applyEffect(accessToken, projectId, effect.id as string),
        applyEffect(accessToken, projectId, effect.id as string),
      ]);

      expect([left.status, right.status]).toEqual([200, 200]);

      const leftBody = await readData(left);
      const rightBody = await readData(right);
      expect(rightBody.appliedAt).toBe(leftBody.appliedAt);

      expect(await countRevisions(characterId)).toBe(before + 1);
      // Filtered on the event type, not on the aggregate alone: creating the
      // character already published one row for the same aggregate, so an
      // unfiltered count would read as "two applies" no matter what the lock
      // did — a test that fails for the wrong reason is as bad as one that
      // passes for the wrong reason.
      expect(
        await prisma.outboxEvent.count({
          where: {
            projectId,
            aggregateId: characterId,
            eventType: "content.updated",
          },
        }),
      ).toBe(1);
    });
  });

  describe("bulk apply", () => {
    it("applies every pending effect in one call and reports the transition as fully applied", async () => {
      const { accessToken, projectId, sceneId, characterId, factionId } =
        await seedFixture();

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Aria falls and joins",
      });
      const transitionId = transition.id as string;

      await addEffect(accessToken, projectId, transitionId, {
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: characterId,
        fieldPath: "archetype",
        newValue: "fallen hero",
      });
      await addEffect(accessToken, projectId, transitionId, {
        effectType: "relationship_add",
        targetEntityType: "character",
        targetEntityId: characterId,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: factionId,
      });

      const response = await request(
        `${transitionsPath(projectId)}/${transitionId}/apply`,
        { method: "POST", accessToken },
      );

      expect(response.status).toBe(200);
      const body = await readData(response);

      expect(body.status).toBe("fully_applied");
      expect(
        (body.effects as JsonObject[]).every(
          (effect) => effect.appliedAt !== null,
        ),
      ).toBe(true);

      const character = await prisma.character.findUnique({
        where: { id: characterId },
      });
      expect(character?.archetype).toBe("fallen hero");
      expect(
        await prisma.contentRelationship.count({ where: { projectId } }),
      ).toBe(1);

      // Idempotent at the aggregate level too: re-applying a fully applied
      // transition is a no-op that answers 200, not a 409 (`applyOneEffect`
      // early-return).
      const again = await request(
        `${transitionsPath(projectId)}/${transitionId}/apply`,
        { method: "POST", accessToken },
      );
      expect(again.status).toBe(200);
      expect(
        await prisma.contentRelationship.count({ where: { projectId } }),
      ).toBe(1);
    });

    // All-or-nothing (notes §10 decision 4). The first effect is valid and the
    // second cannot be applied, so the proof is that the FIRST one's write is
    // absent from the database afterwards — a rollback in Postgres, not an
    // intention in a comment.
    it("rolls the whole batch back when one effect cannot be applied", async () => {
      const { accessToken, projectId, sceneId, characterId, factionId } =
        await seedFixture();

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "One good, one impossible",
      });
      const transitionId = transition.id as string;

      const good = await addEffect(accessToken, projectId, transitionId, {
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: characterId,
        fieldPath: "archetype",
        newValue: "fallen hero",
      });
      // Nothing links these two entities, so the removal has nothing to remove.
      await addEffect(accessToken, projectId, transitionId, {
        effectType: "relationship_remove",
        targetEntityType: "character",
        targetEntityId: characterId,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: factionId,
      });

      const revisionsBefore = await countRevisions(characterId);

      const response = await request(
        `${transitionsPath(projectId)}/${transitionId}/apply`,
        { method: "POST", accessToken },
      );

      expect(response.status).toBe(409);
      expect(await readError(response)).toMatchObject({
        message: "The relationship this effect would remove does not exist",
      });

      const character = await prisma.character.findUnique({
        where: { id: characterId },
      });
      expect(character?.archetype).toBe("mentor");
      expect(await countRevisions(characterId)).toBe(revisionsBefore);

      const stillPending = await prisma.transitionEffect.findUnique({
        where: { id: good.id as string },
        select: { appliedAt: true },
      });
      expect(stillPending?.appliedAt).toBeNull();
    });
  });

  describe("drift answers 409, never a silent success", () => {
    it("refuses to add a relationship that already exists", async () => {
      const { accessToken, projectId, sceneId, characterId, factionId } =
        await seedFixture();

      // Created by hand, i.e. NOT by this transition: claiming provenance over
      // it is what D5 refuses.
      const manual = await request(`/api/v1/projects/${projectId}/relationships`, {
        method: "POST",
        accessToken,
        body: {
          sourceEntityType: "character",
          sourceEntityId: characterId,
          targetEntityType: "faction",
          targetEntityId: factionId,
          relationType: "member_of",
        },
      });
      expect(manual.status).toBe(201);

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Aria joins, again",
      });
      const effect = await addEffect(
        accessToken,
        projectId,
        transition.id as string,
        {
          effectType: "relationship_add",
          targetEntityType: "character",
          targetEntityId: characterId,
          relationshipType: "member_of",
          relatedEntityType: "faction",
          relatedEntityId: factionId,
        },
      );

      const response = await applyEffect(
        accessToken,
        projectId,
        effect.id as string,
      );
      expect(response.status).toBe(409);
      expect(await readError(response)).toMatchObject({
        message: "The relationship this effect would add already exists",
      });

      const stillPending = await prisma.transitionEffect.findUnique({
        where: { id: effect.id as string },
        select: { appliedAt: true },
      });
      expect(stillPending?.appliedAt).toBeNull();
    });

    it("refuses an attribute change the entity already satisfies", async () => {
      const { accessToken, projectId, sceneId, characterId } =
        await seedFixture();

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "A change that changes nothing",
      });
      const effect = await addEffect(
        accessToken,
        projectId,
        transition.id as string,
        {
          effectType: "attribute_change",
          targetEntityType: "character",
          targetEntityId: characterId,
          fieldPath: "archetype",
          // The value `createCharacter` already wrote.
          newValue: "mentor",
        },
      );

      const response = await applyEffect(
        accessToken,
        projectId,
        effect.id as string,
      );
      expect(response.status).toBe(409);
      expect(await readError(response)).toMatchObject({
        message: "Target entity already holds the intended value",
      });
    });
  });

  describe("append-only guards", () => {
    it("refuses to delete an applied effect or a transition that has one", async () => {
      const { accessToken, projectId, sceneId, characterId } =
        await seedFixture();

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Aria falls",
      });
      const transitionId = transition.id as string;
      const effect = await addEffect(accessToken, projectId, transitionId, {
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: characterId,
        fieldPath: "archetype",
        newValue: "fallen hero",
      });

      expect(
        (await applyEffect(accessToken, projectId, effect.id as string)).status,
      ).toBe(200);

      const deleteEffectResponse = await request(
        `${effectsPath(projectId)}/${effect.id as string}`,
        { method: "DELETE", accessToken },
      );
      expect(deleteEffectResponse.status).toBe(409);

      const deleteTransitionResponse = await request(
        `${transitionsPath(projectId)}/${transitionId}`,
        { method: "DELETE", accessToken },
      );
      expect(deleteTransitionResponse.status).toBe(409);

      // Both rows still there: a refused delete must write nothing.
      expect(
        await prisma.transitionEffect.count({
          where: { narrativeTransitionId: transitionId },
        }),
      ).toBe(1);
      expect(
        await prisma.narrativeTransition.findUnique({
          where: { id: transitionId },
        }),
      ).not.toBeNull();
    });

    it("deletes a fully pending transition together with its children", async () => {
      const { accessToken, projectId, sceneId, characterId } =
        await seedFixture();

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Never applied",
      });
      const transitionId = transition.id as string;
      await addEffect(accessToken, projectId, transitionId, {
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: characterId,
        fieldPath: "archetype",
        newValue: "fallen hero",
      });

      const response = await request(
        `${transitionsPath(projectId)}/${transitionId}`,
        { method: "DELETE", accessToken },
      );
      expect(response.status).toBe(200);

      expect(
        await prisma.transitionEffect.count({
          where: { narrativeTransitionId: transitionId },
        }),
      ).toBe(0);
      expect(
        await prisma.narrativeTransition.findUnique({
          where: { id: transitionId },
        }),
      ).toBeNull();

      expect(
        (
          await request(`${transitionsPath(projectId)}/${transitionId}`, {
            accessToken,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe("rejections that must not become 500s", () => {
    it("refuses a field path the allowlist excludes, naming the writable ones", async () => {
      const { accessToken, projectId, sceneId, characterId } =
        await seedFixture();
      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Editorial lifecycle is not narrative",
      });

      // `status` is editorial lifecycle, excluded on purpose (§2) — and the
      // frozen docs' canonical `status -> dead` example is exactly this request.
      const response = await request(
        `${transitionsPath(projectId)}/${transition.id as string}/effects`,
        {
          method: "POST",
          accessToken,
          body: {
            effectType: "attribute_change",
            targetEntityType: "character",
            targetEntityId: characterId,
            fieldPath: "status",
            newValue: "dead",
          },
        },
      );

      expect(response.status).toBe(400);
      const error = await readError(response);
      expect(error.message).toContain("not writable by a narrative transition");
      expect(error.message).toContain("archetype");
    });

    it("refuses an unknown relation type and a disallowed pair", async () => {
      const { accessToken, projectId, sceneId, characterId, factionId } =
        await seedFixture();
      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Registry rules apply here too",
      });
      const path = `${transitionsPath(projectId)}/${transition.id as string}/effects`;

      const unknownType = await request(path, {
        method: "POST",
        accessToken,
        body: {
          effectType: "relationship_add",
          targetEntityType: "character",
          targetEntityId: characterId,
          relationshipType: "invented_by_the_client",
          relatedEntityType: "faction",
          relatedEntityId: factionId,
        },
      });
      expect(unknownType.status).toBe(400);

      // A pair the registry forbids for a type it knows.
      const badPair = await request(path, {
        method: "POST",
        accessToken,
        body: {
          effectType: "relationship_add",
          targetEntityType: "character",
          targetEntityId: characterId,
          relationshipType: "member_of",
          relatedEntityType: "character",
          relatedEntityId: characterId,
        },
      });
      expect(badPair.status).toBe(400);
    });

    it("refuses a body that mixes the two effect variants", async () => {
      const { accessToken, projectId, sceneId, characterId } =
        await seedFixture();
      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Half one thing, half another",
      });

      const response = await request(
        `${transitionsPath(projectId)}/${transition.id as string}/effects`,
        {
          method: "POST",
          accessToken,
          body: {
            effectType: "attribute_change",
            targetEntityType: "character",
            targetEntityId: characterId,
            fieldPath: "archetype",
            newValue: "fallen hero",
            relationshipType: "member_of",
          },
        },
      );

      expect(response.status).toBe(400);
    });

    // Binding requirement (2) from the 7.8 gate: the aggregate-root lock moved
    // the endpoint check ahead of the transition check, so a request wrong on
    // BOTH counts now names the entity. Locking the OLD message here would have
    // pinned a contract that no longer exists.
    it("names the target entity when both the transition and the target are unknown", async () => {
      const { accessToken, projectId } = await seedFixture();

      const response = await request(
        `${transitionsPath(projectId)}/${crypto.randomUUID()}/effects`,
        {
          method: "POST",
          accessToken,
          body: {
            effectType: "attribute_change",
            targetEntityType: "character",
            targetEntityId: crypto.randomUUID(),
            fieldPath: "archetype",
            newValue: "fallen hero",
          },
        },
      );

      expect(response.status).toBe(404);
      expect(await readError(response)).toMatchObject({
        message: "Target entity not found",
      });
    });

    it("refuses a source entity type that is not a cause", async () => {
      const { accessToken, projectId, characterId } = await seedFixture();

      const response = await request(transitionsPath(projectId), {
        method: "POST",
        accessToken,
        body: {
          sourceEntityType: "character",
          sourceEntityId: characterId,
          title: "A character is affected, never a cause",
        },
      });

      expect(response.status).toBe(400);
    });
  });

  describe("permissions", () => {
    it("forbids a Reviewer from writing but not from reading", async () => {
      const fixture = await seedFixture();
      const { accessToken, projectId, sceneId, characterId } = fixture;

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Readable by everyone",
      });
      const transitionId = transition.id as string;
      const effect = await addEffect(accessToken, projectId, transitionId, {
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: characterId,
        fieldPath: "archetype",
        newValue: "fallen hero",
      });

      const reviewer = await registerAndLogin("nt-reviewer");
      await seedMembership(projectId, reviewer.userId, "reviewer", false);

      const writes: Array<[string, string, JsonObject | undefined]> = [
        ["POST", transitionsPath(projectId), {
          sourceEntityType: "scene",
          sourceEntityId: sceneId,
          title: "Reviewer's transition",
        }],
        ["PATCH", `${transitionsPath(projectId)}/${transitionId}`, { title: "Renamed by a reviewer" }],
        ["DELETE", `${transitionsPath(projectId)}/${transitionId}`, undefined],
        ["POST", `${transitionsPath(projectId)}/${transitionId}/apply`, undefined],
        ["POST", `${transitionsPath(projectId)}/${transitionId}/effects`, {
          effectType: "attribute_change",
          targetEntityType: "character",
          targetEntityId: characterId,
          fieldPath: "archetype",
          newValue: "fallen hero",
        }],
        ["DELETE", `${effectsPath(projectId)}/${effect.id as string}`, undefined],
        ["POST", `${effectsPath(projectId)}/${effect.id as string}/apply`, undefined],
      ];

      for (const [method, path, body] of writes) {
        const response = await request(path, {
          method,
          accessToken: reviewer.accessToken,
          body,
        });

        expect(response.status, `${method} ${path} as a reviewer`).toBe(403);
      }

      // Reads stay open: Flow 10's matrix restricts the mutating columns only.
      expect(
        (await request(transitionsPath(projectId), {
          accessToken: reviewer.accessToken,
        })).status,
      ).toBe(200);
      expect(
        (await request(`${transitionsPath(projectId)}/${transitionId}`, {
          accessToken: reviewer.accessToken,
        })).status,
      ).toBe(200);

      // And nothing the reviewer attempted left a trace.
      expect(
        await prisma.narrativeTransition.count({ where: { projectId } }),
      ).toBe(1);
      const untouched = await prisma.transitionEffect.findUnique({
        where: { id: effect.id as string },
        select: { appliedAt: true },
      });
      expect(untouched?.appliedAt).toBeNull();
    });

    // The POSITIVE half of Flow 10's role matrix, which the 7.9 gate found
    // unguarded at all three layers of Blok B: `assertCanWrite` could be changed
    // to lock every Editor out of all ten operations, and the whole 1752-test
    // suite stayed green. A guard that only ever refuses is indistinguishable
    // from a guard that refuses everyone — the lesson Phase 6.6 already wrote
    // down, and the shape 20 lines away in
    // `content-relationship.end2end.test.ts:473-508`.
    //
    // `canDelete: false` is load-bearing in both tests: Flow 10 gives an Editor
    // every column, and this service deliberately has no `assertCanDelete` twin
    // (`NarrativeTransitionController.ts` on the delete path). Seeding an editor
    // WITH the flag would have proved nothing about that decision.
    it("lets an Editor without can_delete declare, add, apply and bulk apply", async () => {
      const { accessToken, projectId, sceneId, characterId, factionId } =
        await seedFixture();
      const editor = await registerAndLogin("nt-editor");
      await seedMembership(projectId, editor.userId, "editor", false);

      const eventId = await createEvent(accessToken, projectId, "The Sundering");

      const transition = await declareTransition(editor.accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Declared by an editor",
      });
      expect(transition.declaredByUserId).toBe(editor.userId);

      const effect = await addEffect(
        editor.accessToken,
        projectId,
        transition.id as string,
        {
          effectType: "attribute_change",
          targetEntityType: "character",
          targetEntityId: characterId,
          fieldPath: "archetype",
          newValue: "fallen hero",
        },
      );

      expect(
        (await applyEffect(editor.accessToken, projectId, effect.id as string))
          .status,
      ).toBe(200);

      // Status codes alone would not prove the write happened under the
      // editor's token.
      const character = await prisma.character.findUnique({
        where: { id: characterId },
      });
      expect(character?.archetype).toBe("fallen hero");

      // Bulk apply, on a transition whose source is an EVENT — which also gives
      // the second nested list route its first e2e exercise (only `scenes` had
      // one).
      const bulk = await declareTransition(editor.accessToken, projectId, {
        sourceEntityType: "event",
        sourceEntityId: eventId,
        title: "Bulk applied by an editor",
      });
      await addEffect(editor.accessToken, projectId, bulk.id as string, {
        effectType: "relationship_add",
        targetEntityType: "character",
        targetEntityId: characterId,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: factionId,
      });

      const bulkResponse = await request(
        `${transitionsPath(projectId)}/${bulk.id as string}/apply`,
        { method: "POST", accessToken: editor.accessToken },
      );
      expect(bulkResponse.status).toBe(200);
      expect((await readData(bulkResponse)).status).toBe("fully_applied");
      expect(
        await prisma.contentRelationship.count({ where: { projectId } }),
      ).toBe(1);

      const nested = await readData(
        await request(
          `/api/v1/projects/${projectId}/events/${eventId}/narrative-transitions`,
          { accessToken: editor.accessToken },
        ),
      );
      expect(
        (nested.narrativeTransitions as JsonObject[]).map((row) => row.id),
      ).toEqual([bulk.id]);
    });

    // Split from the test above on purpose: the delete path is the one guarded
    // by a DECISION rather than by Flow 10's matrix alone ("can_delete is never
    // consulted here"), so it needs a failure of its own. Adding a `canDelete`
    // requirement to `deleteTransition` must turn exactly this test red.
    it("lets an Editor without can_delete delete a pending transition", async () => {
      const { accessToken, projectId, sceneId, characterId } =
        await seedFixture();
      const editor = await registerAndLogin("nt-editor");
      await seedMembership(projectId, editor.userId, "editor", false);

      const transition = await declareTransition(accessToken, projectId, {
        sourceEntityType: "scene",
        sourceEntityId: sceneId,
        title: "Someone else's pending transition",
      });
      const transitionId = transition.id as string;
      const effect = await addEffect(accessToken, projectId, transitionId, {
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: characterId,
        fieldPath: "archetype",
        newValue: "fallen hero",
      });

      // The child first, then its parent — both without `can_delete`, and
      // neither is content: deleting a pending effect destroys an intention.
      expect(
        (
          await request(`${effectsPath(projectId)}/${effect.id as string}`, {
            method: "DELETE",
            accessToken: editor.accessToken,
          })
        ).status,
      ).toBe(200);

      expect(
        (
          await request(`${transitionsPath(projectId)}/${transitionId}`, {
            method: "DELETE",
            accessToken: editor.accessToken,
          })
        ).status,
      ).toBe(200);

      expect(
        await prisma.narrativeTransition.findUnique({
          where: { id: transitionId },
        }),
      ).toBeNull();
    });
  });

  describe("tenant isolation", () => {
    it("answers 404 for a transition, an effect and a source entity from another project", async () => {
      const mine = await seedFixture("nt-writer");
      const theirs = await seedFixture("nt-outsider");

      const theirTransition = await declareTransition(
        theirs.accessToken,
        theirs.projectId,
        {
          sourceEntityType: "scene",
          sourceEntityId: theirs.sceneId,
          title: "Not yours",
        },
      );
      const theirEffect = await addEffect(
        theirs.accessToken,
        theirs.projectId,
        theirTransition.id as string,
        {
          effectType: "attribute_change",
          targetEntityType: "character",
          targetEntityId: theirs.characterId,
          fieldPath: "archetype",
          newValue: "fallen hero",
        },
      );

      // Every probe uses MY project in the path and THEIR id in the resource
      // position, which is the shape that must never leak existence.
      const probes: Array<[string, string]> = [
        ["GET", `${transitionsPath(mine.projectId)}/${theirTransition.id as string}`],
        ["PATCH", `${transitionsPath(mine.projectId)}/${theirTransition.id as string}`],
        ["DELETE", `${transitionsPath(mine.projectId)}/${theirTransition.id as string}`],
        ["POST", `${transitionsPath(mine.projectId)}/${theirTransition.id as string}/apply`],
        ["DELETE", `${effectsPath(mine.projectId)}/${theirEffect.id as string}`],
        ["POST", `${effectsPath(mine.projectId)}/${theirEffect.id as string}/apply`],
        [
          "GET",
          `/api/v1/projects/${mine.projectId}/scenes/${theirs.sceneId}/narrative-transitions`,
        ],
      ];

      for (const [method, path] of probes) {
        const response = await request(path, {
          method,
          accessToken: mine.accessToken,
          body: method === "PATCH" ? { title: "Renamed" } : undefined,
        });

        expect(response.status, `${method} ${path} across tenants`).toBe(404);
      }

      // Their rows are untouched by any of it.
      const theirEffectRow = await prisma.transitionEffect.findUnique({
        where: { id: theirEffect.id as string },
        select: { appliedAt: true },
      });
      expect(theirEffectRow?.appliedAt).toBeNull();
      expect(
        await prisma.narrativeTransition.findUnique({
          where: { id: theirTransition.id as string },
        }),
      ).not.toBeNull();
    });
  });
});
