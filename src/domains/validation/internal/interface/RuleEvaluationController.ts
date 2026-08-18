import { evaluateRuleRequestSchema } from "./dto/ruleAstSchema.js";
import { ruleEvaluationResponseSchema } from "./dto/ruleEvaluationResponseSchema.js";
import {
  requireProjectId,
  type AppEnvironment,
} from "../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../shared/http/requestValidation.js";
import { success } from "../../../../shared/http/response.js";

import type { RuleEvaluationService } from "../application/RuleEvaluationService.js";
import type { Context } from "hono";

// The rule travels in the BODY, not by id, because stored rules are 11.2 proper
// (`RuleService` + versioning + archive) and this slice deliberately stops short
// of it. That makes this endpoint an evaluator you hand a rule to — enough to
// prove the engine end to end, and not enough to pretend the rule catalogue
// exists.
//
// No user id is read: evaluation is a pure question about the project's own
// facts, and membership was already settled by the ProjectScopedRouter before
// this handler runs.
export class RuleEvaluationController {
  constructor(
    private readonly ruleEvaluationService: RuleEvaluationService,
  ) {}

  async evaluateRule(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, evaluateRuleRequestSchema);
    const projectId = requireProjectId(c);

    const outcome = await this.ruleEvaluationService.evaluate(
      projectId,
      dto.ast,
    );

    const response = ruleEvaluationResponseSchema.parse({ outcome });

    return success(c, response);
  }
}

export function createRuleEvaluationController({
  ruleEvaluationService,
}: {
  ruleEvaluationService: RuleEvaluationService;
}): RuleEvaluationController {
  return new RuleEvaluationController(ruleEvaluationService);
}
