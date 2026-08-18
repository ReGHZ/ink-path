import { createRuleEvaluationRoutes } from "../internal/interface/ruleEvaluationRoutes.js";

import type { ProjectScopedRouter } from "../../../shared/http/projectScopedRouter.js";
import type { ValidationDomainCradle } from "../register.js";
import type { AwilixContainer } from "awilix";

// Same contract as mountContentModule and mountProjectModule: `router` is a
// ProjectScopedRouter, which is the type-level proof that authentication and the
// active-membership check are already registered on this prefix. This module
// declares no middleware of its own.
export function mountValidationModule(
  router: ProjectScopedRouter,
  container: AwilixContainer<ValidationDomainCradle>,
): void {
  router.route(
    "/",
    createRuleEvaluationRoutes({
      ruleEvaluationController: container.resolve("ruleEvaluationController"),
    }),
  );
}
