import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createGraphProjector,
  type GraphProjectorEventPayload,
} from "../../src/domains/validation/internal/application/GraphProjector.js";
import { PrismaAssertionLogReader } from "../../src/domains/validation/internal/infrastructure/PrismaAssertionLogReader.js";
import { PrismaEvaluationGraphRepository } from "../../src/domains/validation/internal/infrastructure/PrismaEvaluationGraphRepository.js";
import { createAppContainer } from "../../src/infrastructure/container.js";
import { createRabbitMqConsumer } from "../../src/infrastructure/queue/consumer.js";
import { GRAPH_PROJECTOR_BINDINGS } from "../../src/shared/application/events/routingKeys.js";
import { seedProjectVocabulary } from "../helpers/relationshipVocabulary.js";

import type { RelationshipService } from "../../src/domains/content/internal/application/support/RelationshipService.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { RabbitMqPublisher } from "../../src/infrastructure/queue/publisher.js";
import type { RabbitMqManager } from "../../src/infrastructure/queue/rabbitmqManager.js";
import type { Consumer } from "../../src/shared/application/ports/Consumer.js";

// Step 4b-4, stage C. The hops NOTHING else can cover: a real topic exchange with
// BOTH of the projector's bindings, and the payload a real producer actually wrote.
//
// The two things this file exists for, in order of what they would cost if wrong:
//
//   1. THE BINDINGS DELIVER. Gerbang G1's blocker T-1 was exactly this class of bug:
//      `content.relationship.asserted` was published to an exchange where no queue was
//      listening, three documents claimed the opposite, and every test was green.
//      `routingKeys.test.ts` applies AMQP's matching rule in TypeScript; only a real
//      broker proves the queue was bound to both prefixes. Test 2 is the second
//      pattern, and it is the one a single-binding consumer would silently drop.
//   2. THE PAYLOAD FITS. `GraphProjector.test.ts` feeds the fold payloads written by
//      hand from reading the producers. Test 1 instead runs the real
//      `RelationshipService`, takes the outbox row VERBATIM — routing key and payload —
//      and publishes that, so a renamed field fails here instead of in production.
//
// Not covered here, deliberately: the outbox dispatcher's poll-and-publish hop. It has
// its own e2e (`outbox-worker-qdrant.end2end.test.ts`), and starting a dispatcher in
// this file would also make it claim every other test's pending backlog.
//
// The queue name is unique per run, like `consumer-retry-dlq.integration.test.ts`: a
// topic exchange copies every matching message to every bound queue, so binding the
// production queue name would make this test eat the events other integration tests
// leave behind — and the handler filters on this file's own project id for the same
// reason.
//
// FIXTURE ID BLOCK 021 — owner/project ids end in `...0000000021NN`, entity and
// assertion ids use the `6a6a6a6a` prefix. Both were unused when this file was written
// (blocks 000-020 taken; prefixes 00000000/1x/2x/3x-9x/616263/64-67/68-70 claimed
// elsewhere). Vitest runs files in parallel and each cleans up its own project, so a
// shared block makes two files delete each other's fixtures intermittently.
const now = new Date("2026-08-19T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000002101";
const projectId = "00000000-0000-4000-8000-000000002102";

// Created through the REAL CharacterService, so their ids come from the app's own
// generator rather than from this file's prefix. That is not a fixture-block violation
// but its consequence: `ContentEntityLocator` hydrates a Character aggregate, which
// requires a current revision, so a hand-inserted row is rejected with "Current
// revision id is required" — the entity has to be created the way the app creates it.
let characterA = "";
let characterB = "";
let characterC = "";

const membership = { role: "writer", canDelete: true } as const;

const PIPELINE_TIMEOUT_MS = 20_000;

// ONE container for the file. A second `createAppContainer()` inside a test would open a
// second Prisma pool that nothing ever disconnects, in a file that also holds a broker
// connection.
let relationshipService: RelationshipService;
let prisma: PrismaClient;
let rabbitmq: RabbitMqManager;
let publisher: RabbitMqPublisher;
let consumer: Consumer;

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.evaluationEdge.deleteMany({ where: { projectId } });
  await client.evaluationNode.deleteMany({ where: { projectId } });
  await client.contentRelationship.deleteMany({ where: { projectId } });
  await client.assertion.deleteMany({ where: { projectId } });
  await client.narrativeTransition.deleteMany({ where: { projectId } });
  await client.relationshipDefinition.deleteMany({ where: { projectId } });
  await client.outboxEvent.deleteMany({ where: { projectId } });
  // Characters here are created through the real service, so each one also has
  // `content_revisions` rows and a `current_revision_id` pointing at one. The pointer
  // has to be dropped before the revisions can go, and the revisions before the
  // character — three levels the other 4b-4 test file never needed, because it inserts
  // no real content entities.
  await client.character.updateMany({
    where: { projectId },
    data: { currentRevisionId: null },
  });
  await client.contentRevision.deleteMany({ where: { projectId } });
  await client.character.deleteMany({ where: { projectId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

// Polls instead of sleeping: the broker hop has no completion signal on this side, and
// a fixed sleep is either flaky or slow. Every caller states what it is waiting for.
async function waitUntil(
  what: string,
  condition: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting until ${what}`);
}

function edgeCount(sourceAssertionId: string): Promise<number> {
  return prisma.evaluationEdge.count({
    where: { projectId, sourceAssertionId },
  });
}

async function seedAssertion(
  id: string,
  objectEntityId: string,
): Promise<string> {
  const definition = await prisma.relationshipDefinition.findFirstOrThrow({
    where: { projectId, predicate: "ally_of" },
    select: { id: true },
  });

  await prisma.assertion.create({
    data: {
      id,
      projectId,
      narrativeTransitionId: null,
      operation: "relationship_add",
      targetEntityType: "character",
      targetEntityId: characterA,
      relationshipType: "ally_of",
      relationshipDefinitionId: definition.id,
      relatedEntityType: "character",
      relatedEntityId: objectEntityId,
      appliedAt: now,
      createdAt: now,
    },
  });

  return id;
}

beforeAll(async () => {
  const container = createAppContainer();

  prisma = container.resolve("prisma");
  rabbitmq = container.resolve("rabbitmq");
  publisher = container.resolve("rabbitMqPublisher");
  relationshipService = container.resolve("relationshipService");

  await cleanDatabase(prisma);

  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: "graph-projector-e2e@example.com",
      passwordHash: "hashed-password",
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      ownerUserId,
      createdByUserId: ownerUserId,
      name: "Graph projector e2e",
      createdAt: now,
      updatedAt: now,
    },
  });

  const characterService = container.resolve("characterService");
  const created: string[] = [];

  for (const name of ["Bima", "Arjuna", "Karna"]) {
    const character = await characterService.createCharacter({
      requestingUserId: ownerUserId,
      requestingMembership: membership,
      projectId,
      name,
    });

    created.push(character.characterId);
  }

  [characterA, characterB, characterC] = created as [string, string, string];

  await seedProjectVocabulary(prisma, projectId);

  // The REAL fold behind a test-scoped consumer: real ports, real Postgres, real
  // projector. Only the queue name is test-owned.
  const projector = createGraphProjector({
    assertionLogReader: new PrismaAssertionLogReader(prisma),
    evaluationGraphRepository: new PrismaEvaluationGraphRepository(prisma),
  });

  consumer = createRabbitMqConsumer<GraphProjectorEventPayload>(rabbitmq, {
    queue: `graph-projector-e2e-${process.pid}`,
    // The PRODUCTION patterns, imported. Spelling them out here would let this test
    // pass while the real consumer bound something else.
    routingKeyPattern: GRAPH_PROJECTOR_BINDINGS,
    // `prefetch: 1` is what makes the FENCE below a control instead of a coincidence
    // (blokir gerbang 4b-4 G4-2). The broker sends the next message only after the previous
    // one is acked, so completion order is guaranteed — without it the consumer starts a
    // handler per delivery without awaiting the previous one, and "the fence was folded"
    // proved only that the removal handler had STARTED. A mutant that deleted the edge
    // 400 ms late passed the whole file: the control depended on the speed of the code
    // under test.
    prefetch: 1,
    handleMessage: async ({ routingKey, payload }) => {
      if (payload.projectId !== projectId) {
        // Another test's traffic, delivered because a topic exchange copies to every
        // matching queue. Acked and ignored rather than folded.
        return;
      }

      await projector.handleEvent(routingKey, payload);
    },
  });

  await rabbitmq.start();
  // The publisher opens its own channel and asserts the exchange; without this every
  // publish below fails with "channel not available". Production starts it through the
  // container the same way (`src/api.ts`).
  await publisher.start();
  await consumer.start();
}, PIPELINE_TIMEOUT_MS);

afterAll(async () => {
  await consumer.stop();
  await publisher.stop();
  await rabbitmq.stop();
  await cleanDatabase(prisma);
  await prisma.$disconnect();
});

// S-2 of the 4b-4 gate: `graphProjectorConsumer.test.ts` mocks `createRabbitMqConsumer`
// and injects `rabbitmq: {} as never`, and the pipeline test below assembles the projector
// by hand — so without this, the four registrations in `register.ts` and the two
// `container.resolve` calls in `src/graphProjectorWorker.ts` were pinned by nothing, and a
// missing registration would only surface when the worker process was started.
describe("production wiring", () => {
  it("resolves the projector and its consumer from the real container", () => {
    const container = createAppContainer();

    // Resolving does NOT start the consumer, so no queue is bound and no broker connection
    // is opened by this test — it exercises exactly the graph awilix has to build.
    expect(container.resolve("graphProjectorConsumer")).toBeDefined();
    expect(container.resolve("graphProjector")).toBeDefined();
    expect(container.resolve("assertionLogReader")).toBeDefined();
    expect(container.resolve("evaluationGraphRepository")).toBeDefined();
  });
});

describe("assertion log -> RabbitMQ -> GraphProjector -> evaluation graph (4b-4)", () => {
  it(
    "folds the payload the CRUD producer actually wrote, over the key it actually used",
    async () => {
      const relationship = await relationshipService.createRelationship({
        requestingUserId: ownerUserId,
        requestingMembership: membership,
        projectId,
        sourceEntityType: "character",
        sourceEntityId: characterA,
        targetEntityType: "character",
        targetEntityId: characterB,
        relationType: "ally_of",
      });

      const event = await prisma.outboxEvent.findFirstOrThrow({
        where: { projectId, aggregateId: relationship.id },
        select: { routingKey: true, payload: true },
      });

      // VERBATIM: whatever the service wrote is what the broker carries. A renamed
      // payload field or a shortened routing key fails here.
      await publisher.publish(event.routingKey, event.payload);

      const payload = event.payload as { assertionId: string };

      await waitUntil("the asserted fact is folded into the graph", async () => {
        return (await edgeCount(payload.assertionId)) === 1;
      });

      const edge = await prisma.evaluationEdge.findFirstOrThrow({
        where: { projectId, sourceAssertionId: payload.assertionId },
        include: { sourceNode: true, targetNode: true },
      });

      expect(edge.relationshipType).toBe("ally_of");
      expect(edge.sourceNode.entityId).toBe(characterA);
      expect(edge.targetNode.entityId).toBe(characterB);
    },
    PIPELINE_TIMEOUT_MS,
  );

  it(
    "delivers the SECOND bound pattern too, which a single binding would drop",
    async () => {
      const assertionId = await seedAssertion(
        "6a6a6a6a-0000-4000-8000-000000000002",
        characterC,
      );

      await publisher.publish("narrative.assertion.applied", {
        projectId,
        operation: "relationship_add",
        assertionId,
      });

      // `narrative.assertion.*` matches neither `content.*` nor `content.relationship.*`.
      // If the queue carried one binding, this fact would simply never arrive and the
      // graph would be quietly incomplete — the failure T-1 was about.
      await waitUntil("the narrated assertion is folded", async () => {
        return (await edgeCount(assertionId)) === 1;
      });
    },
    PIPELINE_TIMEOUT_MS,
  );

  it(
    "leaves the edge standing when a narrated removal arrives, and deletes it on retraction",
    async () => {
      const terminated = await seedAssertion(
        "6a6a6a6a-0000-4000-8000-000000000003",
        characterB,
      );
      const fence = await seedAssertion(
        "6a6a6a6a-0000-4000-8000-000000000004",
        characterC,
      );

      await publisher.publish("narrative.assertion.applied", {
        projectId,
        operation: "relationship_add",
        assertionId: terminated,
      });
      await waitUntil("the fact to terminate is folded", async () => {
        return (await edgeCount(terminated)) === 1;
      });

      await publisher.publish("narrative.assertion.applied", {
        projectId,
        operation: "relationship_remove",
        assertionId: null,
        terminationId: "6a6a6a6a-0000-4000-8000-0000000000f1",
        targetAssertionId: terminated,
      });

      // A FENCE, not a sleep: the removal carries no observable assertion by design, so
      // this publishes a message BEHIND it on the same queue and waits for that one.
      // Once the fence is folded, the removal has already been consumed — which is what
      // makes the assertion below about a decision rather than about timing.
      await publisher.publish("narrative.assertion.applied", {
        projectId,
        operation: "relationship_add",
        assertionId: fence,
      });
      await waitUntil("the fence message behind the removal is folded", async () => {
        return (await edgeCount(fence)) === 1;
      });

      // THE DECISION, end to end: a narrated removal writes `terminate`, and a
      // terminated fact HELD before its anchor. Deleting the edge here would answer
      // "never held" to every earlier cut, with every table still consistent.
      expect(await edgeCount(terminated)).toBe(1);

      // Retraction is the other half, and it must reach the same row: the claim counts
      // as never made.
      await publisher.publish("content.relationship.retracted", {
        projectId,
        assertionId: terminated,
        retractionId: "6a6a6a6a-0000-4000-8000-0000000000f2",
      });

      await waitUntil("the retracted edge is gone", async () => {
        return (await edgeCount(terminated)) === 0;
      });

      // The terminated-but-not-retracted neighbour is untouched — a retraction removes
      // ONE fact, not the endpoint's other facts.
      expect(await edgeCount(fence)).toBe(1);
    },
    PIPELINE_TIMEOUT_MS,
  );
});
