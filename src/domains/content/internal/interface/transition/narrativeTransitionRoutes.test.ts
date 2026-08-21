import { describe, expect, it } from "vitest";

import { createNarrativeTransitionRoutes } from "./narrativeTransitionRoutes.js";

import type { NarrativeTransitionController } from "./NarrativeTransitionController.js";
import type { NarrativeTransitionSourceType } from "../../domain/transition/NarrativeTransition.js";
import type { Context } from "hono";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TRANSITION_ID = "22222222-2222-4222-8222-222222222222";
const EFFECT_ID = "33333333-3333-4333-8333-333333333333";
const ENTITY_ID = "44444444-4444-4444-8444-444444444444";

type Dispatch = { handler: string; sourceEntityType?: string };

// A recording stand-in for the controller. The cast is unavoidable and narrow:
// `NarrativeTransitionController` is a class with a private field, so no object
// literal is structurally assignable to it, and the alternatives — extracting an
// interface only tests would use, or building the real controller over a real
// service over nine fake repositories — would change production code or test a
// great deal more than the route table.
//
// What this file proves is exactly the part no other test can see. The
// route-protection suite walks whatever `app.routes` contains, so it stays green
// if a route is registered under the wrong METHOD or a mistyped path; the 7.9
// e2e will exercise the happy paths but through the same URLs this table
// defines. Here the URL and the verb are the assertion.
function recordingController(): {
  controller: NarrativeTransitionController;
  calls: Dispatch[];
} {
  const calls: Dispatch[] = [];

  const respond = (c: Context, handler: string, sourceEntityType?: string) => {
    const call: Dispatch = { handler, ...(sourceEntityType && { sourceEntityType }) };
    calls.push(call);

    return c.json(call);
  };

  const controller = {
    declareTransition: (c: Context) => respond(c, "declareTransition"),
    listTransitions: (c: Context) => respond(c, "listTransitions"),
    listTransitionsBySourceEntity: (
      c: Context,
      sourceEntityType: NarrativeTransitionSourceType,
    ) => respond(c, "listTransitionsBySourceEntity", sourceEntityType),
    getTransition: (c: Context) => respond(c, "getTransition"),
    updateTransitionDetails: (c: Context) =>
      respond(c, "updateTransitionDetails"),
    deleteTransition: (c: Context) => respond(c, "deleteTransition"),
    addAssertion: (c: Context) => respond(c, "addAssertion"),
    deleteAssertion: (c: Context) => respond(c, "deleteAssertion"),
    applyAssertion: (c: Context) => respond(c, "applyAssertion"),
    applyTransition: (c: Context) => respond(c, "applyTransition"),
  } as unknown as NarrativeTransitionController;

  return { controller, calls };
}

async function dispatch(method: string, path: string): Promise<Dispatch> {
  const { controller } = recordingController();
  const routes = createNarrativeTransitionRoutes({
    narrativeTransitionController: controller,
  });

  const response = await routes.request(path, { method });

  expect(response.status, `${method} ${path}`).toBe(200);

  return (await response.json()) as Dispatch;
}

describe("createNarrativeTransitionRoutes", () => {
  it("routes each verb of the transition collection to its own handler", async () => {
    const base = `/${PROJECT_ID}/narrative-transitions`;

    await expect(dispatch("POST", base)).resolves.toEqual({
      handler: "declareTransition",
    });
    await expect(dispatch("GET", base)).resolves.toEqual({
      handler: "listTransitions",
    });
    await expect(
      dispatch("GET", `${base}/${TRANSITION_ID}`),
    ).resolves.toEqual({ handler: "getTransition" });
    await expect(
      dispatch("PATCH", `${base}/${TRANSITION_ID}`),
    ).resolves.toEqual({ handler: "updateTransitionDetails" });
    await expect(
      dispatch("DELETE", `${base}/${TRANSITION_ID}`),
    ).resolves.toEqual({ handler: "deleteTransition" });
  });

  // The two operations that hang off the transition because they need its id:
  // adding an assertion, and applying every pending assertion it has (D9).
  it("routes the nested assertion and bulk apply paths", async () => {
    const base = `/${PROJECT_ID}/narrative-transitions/${TRANSITION_ID}`;

    await expect(dispatch("POST", `${base}/assertions`)).resolves.toEqual({
      handler: "addAssertion",
    });
    await expect(dispatch("POST", `${base}/apply`)).resolves.toEqual({
      handler: "applyTransition",
    });
  });

  // D10: an assertion is addressed by its own id alone, so its URL says so. A
  // nested `/narrative-transitions/:id/assertions/:effectId` would promise a
  // containment check the service never performs.
  it("routes the two per-assertion operations on the flat collection", async () => {
    const base = `/${PROJECT_ID}/assertions/${EFFECT_ID}`;

    await expect(dispatch("DELETE", base)).resolves.toEqual({
      handler: "deleteAssertion",
    });
    await expect(dispatch("POST", `${base}/apply`)).resolves.toEqual({
      handler: "applyAssertion",
    });
  });

  // The entity type reaches the handler as a constant from the route table, so
  // this is what proves the loop wired each segment to the type it names — a
  // swapped pair would be invisible to every other test.
  it("routes all three nested lists and hands each its own source type", async () => {
    // The segments are spelled out rather than read from NESTED_TRANSITION_ROUTES:
    // a test that derives its expectation from the table under test would stay
    // green if the table itself pointed `event` at the chapter entry.
    const cases: Array<[string, NarrativeTransitionSourceType]> = [
      ["scenes", "scene"],
      ["events", "event"],
      ["chapters", "chapter"],
    ];

    for (const [segment, sourceEntityType] of cases) {
      const path = `/${PROJECT_ID}/${segment}/${ENTITY_ID}/narrative-transitions`;

      await expect(dispatch("GET", path)).resolves.toEqual({
        handler: "listTransitionsBySourceEntity",
        sourceEntityType,
      });
    }
  });

  it("registers twelve routes and every path parameter ends in Id", () => {
    const { controller } = recordingController();
    const routes = createNarrativeTransitionRoutes({
      narrativeTransitionController: controller,
    });

    const registered = routes.routes.map(
      (route) => `${route.method} ${route.path}`,
    );

    expect(new Set(registered).size).toBe(12);

    // The uuid guard is a single middleware keyed on the `Id` suffix
    // (`shared/http/projectScopedRouter.ts`); a parameter named `:assertion` would
    // silently opt out of it and answer 500 for a malformed value.
    for (const route of routes.routes) {
      for (const segment of route.path.split("/")) {
        if (segment.startsWith(":")) {
          expect(segment, `${route.method} ${route.path}`).toMatch(/Id$/);
        }
      }
    }
  });
});
