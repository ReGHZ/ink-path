import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { uuidRouteParameterMiddleware } from "./projectScopedRouter.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { AppEnvironment } from "./context.js";

// Driven through a REAL Hono router, not a stubbed context, and that is the
// whole point of this file. The first version of this middleware read
// `c.req.param()` — which a hand-rolled stub answers however you like, and which
// Hono actually scopes to the pattern a handler was registered with, so inside
// `/:projectId/*` it never sees an entity id. A stub agreed with itself and the
// e2e sweep was left to find the bug. Real routing here means the matcher, the
// registration order and the parameter binding are the things under test.
async function runRoute(
  routePattern: string,
  path: string,
): Promise<{ status: number; reachedHandler: boolean; thrown: unknown }> {
  const app = new Hono<AppEnvironment>({ strict: true });
  let reachedHandler = false;
  let thrown: unknown;

  app.use("/:projectId/*", uuidRouteParameterMiddleware);
  app.on(["GET", "POST", "PATCH", "DELETE"], routePattern, (c) => {
    reachedHandler = true;

    return c.text("handler");
  });
  app.onError((error) => {
    thrown = error;

    return new Response("", {
      status: error instanceof AppError ? 599 : 500,
    });
  });

  const response = await app.request(path);

  return { status: response.status, reachedHandler, thrown };
}

const VALID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ENTITY_ROUTE = "/:projectId/characters/:characterId";

describe("uuidRouteParameterMiddleware", () => {
  it("passes the request through when every id is canonical", async () => {
    const { reachedHandler, thrown } = await runRoute(
      ENTITY_ROUTE,
      `/${VALID}/characters/${OTHER}`,
    );

    expect(thrown).toBeUndefined();
    expect(reachedHandler).toBe(true);
  });

  // The failure that matters is not "it throws" but "it throws BEFORE the
  // handler runs": the point of moving this out of the controllers is that a
  // malformed value never reaches Prisma, where it raises P2007 and surfaces as
  // a 500.
  it("answers 404 without reaching the handler when an id is malformed", async () => {
    const { reachedHandler, thrown } = await runRoute(
      ENTITY_ROUTE,
      `/${VALID}/characters/not-a-uuid`,
    );

    expect(reachedHandler).toBe(false);
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe(ErrorCode.NOT_FOUND);
    // 404, not 400, and a generic message: malformed, absent and someone else's
    // must stay indistinguishable, or the shape of an id becomes a way to probe
    // what exists.
    expect((thrown as AppError).message).toBe("Not found");
  });

  // A route can bind more than one id beyond `:projectId`
  // (`/chapters/:chapterId/scenes`, `/members/:userId`). Judging only the first
  // — or only `:projectId`, which ProjectMemberMiddleware already guards —
  // would leave exactly the 39 inherited routes this middleware closes.
  it("judges an id at any position, not just the last segment", async () => {
    const { reachedHandler, thrown } = await runRoute(
      "/:projectId/chapters/:chapterId/scenes",
      `/${VALID}/chapters/not-a-uuid/scenes`,
    );

    expect(reachedHandler).toBe(false);
    expect(thrown).toBeInstanceOf(AppError);
  });

  // The rule is a naming convention, deliberately: Phase 12's invitation token
  // is not a uuid. It will be mounted outside the project-scoped router, but a
  // project-scoped non-id parameter must stay possible too, so the convention is
  // locked here rather than discovered later.
  it("ignores a parameter whose name does not end in Id", async () => {
    const { reachedHandler, thrown } = await runRoute(
      "/:projectId/invitations/:token",
      `/${VALID}/invitations/not-a-uuid-and-never-will-be`,
    );

    expect(thrown).toBeUndefined();
    expect(reachedHandler).toBe(true);
  });

  // A collection route binds only `:projectId`. Nothing for this middleware to
  // add — and if it started rejecting requests it cannot judge, every list
  // endpoint on the surface would break.
  it("passes through a route that carries no id beyond the project", async () => {
    const { reachedHandler } = await runRoute(
      "/:projectId/characters",
      `/${VALID}/characters`,
    );

    expect(reachedHandler).toBe(true);
  });

  // `:projectId` itself is guarded upstream by ProjectMemberMiddleware, which
  // owns its 404 message. This middleware still judges it — belt and braces on
  // the one parameter that decides tenancy — and must not let a malformed one
  // through just because it arrives on a route with no other id.
  it("still judges a malformed :projectId", async () => {
    const { reachedHandler, thrown } = await runRoute(
      "/:projectId/characters",
      "/not-a-uuid/characters",
    );

    expect(reachedHandler).toBe(false);
    expect(thrown).toBeInstanceOf(AppError);
  });
});
