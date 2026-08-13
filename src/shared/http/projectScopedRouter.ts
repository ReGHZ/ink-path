import { Hono, type MiddlewareHandler } from "hono";

import type { AppEnvironment } from "./context.js";

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

  return router as ProjectScopedRouter;
}
