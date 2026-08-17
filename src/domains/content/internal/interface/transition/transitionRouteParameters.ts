// The two path-parameter NAMES, in one module so the route table and the
// handlers cannot disagree about them.
//
// They were string literals in both files for one draft, and that is a pair that
// can drift silently: renaming `:transitionEffectId` in the router alone leaves
// every route matching and every apply answering 404, because
// `requireRouteParameter` would look up a name Hono never bound. No unit test
// can see it — the paths still resolve — and only an e2e that actually applies
// an effect would. Making the disagreement unexpressible is the same move the
// 7.7 gate made when it deleted the `entityType` cell from the write dispatch
// table: better than a test that watches for it.
//
// Both end in `Id` because that suffix is what `uuidRouteParameterMiddleware`
// keys on (`shared/http/projectScopedRouter.ts`); a parameter that opts out of
// it answers 500 for a malformed value instead of 404.
//
// The three NESTED parameters (`sceneId`, `eventId`, `chapterId`) are not here:
// they already come from `NESTED_TRANSITION_ROUTES`, which the loop and the
// handler both read, so they have the same single source by construction.
export const NARRATIVE_TRANSITION_ID_PARAMETER = "narrativeTransitionId";
export const TRANSITION_EFFECT_ID_PARAMETER = "transitionEffectId";
