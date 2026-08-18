import { asFunction, type AwilixContainer } from "awilix";

import {
  createRuleEvaluationService,
  type RuleEvaluationService,
} from "./internal/application/RuleEvaluationService.js";
import { createEvaluationFactReader } from "./internal/infrastructure/PrismaEvaluationFactReader.js";
import {
  createRuleEvaluationController,
  type RuleEvaluationController,
} from "./internal/interface/RuleEvaluationController.js";

import type { EvaluationFactReader } from "./internal/domain/EvaluationFactReader.js";

export type ValidationDomainCradle = {
  evaluationFactReader: EvaluationFactReader;
  ruleEvaluationService: RuleEvaluationService;
  ruleEvaluationController: RuleEvaluationController;
};

export function registerValidationDomain(
  container: AwilixContainer<ValidationDomainCradle>,
): void {
  container.register({
    evaluationFactReader: asFunction(createEvaluationFactReader).singleton(),
    ruleEvaluationService: asFunction(createRuleEvaluationService).singleton(),
    ruleEvaluationController: asFunction(
      createRuleEvaluationController,
    ).singleton(),
  });
}
