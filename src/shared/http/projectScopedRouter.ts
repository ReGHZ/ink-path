import { Hono, type MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";

import { isCanonicalUuid, type AppEnvironment } from "./context.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

declare const projectScoped: unique symbol;

// A Hono router that is PROVEN to sit behind authentication and an active
// project-membership check. The brand is not decoration: `mountProjectModule`
// and `mountContentModule` accept this type and nothing else, so a plain
// `new Hono()` cannot be passed to them — mounting project-scoped routes onto
// an unprotected router is a compile error rather than a convention someone can
// forget. The single cast that produces the brand lives in the factory below,
// immediately beside the `use()` calls that justify it.
export type ProjectScopedRouter = Hono<AppEnvironment> & {
  readonly [projectScoped]: true;
};

// One registration each, for the whole `/projects` surface.
//
// Before this existed, every entity router declared its own copy
// (`routes.use("*", authMiddleware)` + `routes.use("/:projectId/*", ...)`) and
// all of them were mounted onto the SAME prefix. Hono merges sub-app routes
// into the parent, so every one of those registrations matched every
// project-scoped request: measured at 10-11 executions of
// projectMemberMiddleware for a single GET, meaning 10-11 identical
// `userProject.findFirst` queries and as many JWT verifications, growing by two
// more with every entity added. Declaring the protection once, at the boundary
// that actually owns it, removes the duplication instead of making it cheap.
// Every id in a project-scoped path addresses a `@db.Uuid` column. Handed a
// malformed value, Prisma raises `P2007`, which no mapper here translates
// (`prismaErrors.ts` knows P2002/P2003/P2025 only), so it used to surface as a
// **500**: a client mistake reported as a server fault, repeated forever by any
// retry-on-5xx caller and mixed into the 5xx rate that production alerts on.
//
// Enforced HERE rather than at each call site, and that is the whole point. The
// per-controller version of this rule shipped with 7.3 covered the routes then
// being written and left 39 inherited ones behind; every future router would
// have had to remember it again. Declared once at the boundary that already owns
// authentication and membership, it cannot be forgotten by a router that has not
// been written yet — the same reason those two live here (see above).
//
// Runs AFTER projectMemberMiddleware on purpose: `:projectId` is that
// middleware's own guard (and its own 404 message), so by the time this executes
// the only ids left to judge are the entity ones.
//
// Convention, not a type: any parameter whose name ends in `Id`. Phase 12's
// `/invitations/:token` is not project-scoped and would not match anyway, but the
// naming rule keeps a non-uuid parameter possible on this surface too.
//
// 404, matching the `requireRouteParameter` family: a path segment is a resource
// identity, and a syntactically impossible id addresses nothing. The message
// stays generic because a middleware cannot know which entity was meant — a real
// lookup still answers "Character not found" from its own service. Ids arriving
// in a request BODY are data fields, not identity, and stay 400 via `z.uuid()`.
//
// Do NOT replace this by mapping P2007 in the error handler: P2007 is a generic
// "data validation error", and mapping it wholesale to 4xx would swallow
// failures that genuinely are ours.
export const uuidRouteParameterMiddleware: MiddlewareHandler<
  AppEnvironment
> = async (c, next) => {
  // `c.req.param()` is NOT usable here, and finding that out is what the route
  // sweep in `route-protection.end2end.test.ts` is for: Hono binds parameters
  // per REGISTRATION pattern, so inside a middleware mounted on `/:projectId/*`
  // it answers `{ projectId }` alone — every entity id is bound only once the
  // route handler runs, which is one step too late. The matched route pattern
  // is available though, and zipping it against the request path recovers the
  // ids the middleware is here to judge.
  //
  // Last non-wildcard entry = the route handler's own pattern; the wildcard
  // entries are this middleware and its neighbours. `routePath(c, -1)` would
  // read shorter but assumes the LAST matched handler is always the route —
  // true today, silently false the day a middleware is registered after the
  // routers are mounted, and failing open is the one way this guard must not
  // fail.
  const routePattern = [...matchedRoutes(c)]
    .reverse()
    .find((route) => !route.path.includes("*"))?.path;

  if (routePattern) {
    const patternSegments = routePattern.split("/");
    const pathSegments = c.req.path.split("/");

    for (const [index, segment] of patternSegments.entries()) {
      if (!segment.startsWith(":") || !segment.endsWith("Id")) {
        continue;
      }

      const value = pathSegments[index];

      if (value === undefined || !isCanonicalUuid(value)) {
        throw new AppError(ErrorCode.NOT_FOUND, "Not found");
      }
    }
  }

  await next();
};

export function createProjectScopedRouter({
  authMiddleware,
  projectMemberMiddleware,
}: {
  authMiddleware: MiddlewareHandler<AppEnvironment>;
  projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
}): ProjectScopedRouter {
  const router = new Hono<AppEnvironment>({ strict: true });

  router.use("*", authMiddleware);
  // ONE pattern, not the two `projectRoutes` used to declare. Hono's `*` also
  // matches the empty remainder, so `/:projectId/*` already covers the bare
  // `/:projectId` — keeping the separate exact registration made the membership
  // check run twice on `GET /projects/:projectId`, which is how the old code
  // behaved and what the route-protection suite now forbids. Routes with no
  // `:projectId` at all (`POST /projects`) match neither and stay
  // authenticated-but-membership-free, unchanged.
  router.use("/:projectId/*", projectMemberMiddleware);
  router.use("/:projectId/*", uuidRouteParameterMiddleware);

  return router as ProjectScopedRouter;
}
