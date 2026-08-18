import { Hono } from "hono";

import type { RuleEvaluationController } from "./RuleEvaluationController.js";
import type { AppEnvironment } from "../../../../shared/http/context.js";

// POST rather than GET even though nothing is stored: the rule is a nested
// document that has no business in a query string, and it is the request body
// that carries it.
//
// No middleware here. `ProjectScopedRouter` already registered authentication
// and the active-membership check on this prefix, and the type is what proves
// it — same contract every content router works under.
export function createRuleEvaluationRoutes({
  ruleEvaluationController,
}: {
  ruleEvaluationController: RuleEvaluationController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/rule-evaluations", (c) =>
    ruleEvaluationController.evaluateRule(c),
  );

  return routes;
}
