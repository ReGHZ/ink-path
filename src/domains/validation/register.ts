import { asFunction, type AwilixContainer } from "awilix";

import {
  createGraphProjector,
  type GraphProjector,
} from "./internal/application/GraphProjector.js";
import {
  createRuleEvaluationService,
  type RuleEvaluationService,
} from "./internal/application/RuleEvaluationService.js";
import { createGraphProjectorConsumer } from "./internal/infrastructure/graphProjectorConsumer.js";
import { createAssertionLogReader } from "./internal/infrastructure/PrismaAssertionLogReader.js";
import { createEvaluationFactReader } from "./internal/infrastructure/PrismaEvaluationFactReader.js";
import { createEvaluationGraphRepository } from "./internal/infrastructure/PrismaEvaluationGraphRepository.js";
import {
  createRuleEvaluationController,
  type RuleEvaluationController,
} from "./internal/interface/RuleEvaluationController.js";

import type { AssertionLogReader } from "./internal/domain/AssertionLogReader.js";
import type { EvaluationFactReader } from "./internal/domain/EvaluationFactReader.js";
import type { EvaluationGraphRepository } from "./internal/domain/EvaluationGraphRepository.js";
import type { Consumer } from "../../shared/application/ports/Consumer.js";

export type ValidationDomainCradle = {
  evaluationFactReader: EvaluationFactReader;
  // Step 4b-4. The fold of the assertion log — its two ports, the projector that
  // decides what each log operation does to the graph, and the consumer that feeds it.
  assertionLogReader: AssertionLogReader;
  evaluationGraphRepository: EvaluationGraphRepository;
  graphProjector: GraphProjector;
  // Registered here, but started by `src/graphProjectorWorker.ts` alone — resolving a
  // consumer does not start it, so `src/api.ts` and the other workers building the
  // same container do not accidentally grow a second projector.
  graphProjectorConsumer: Consumer;
  ruleEvaluationService: RuleEvaluationService;
  ruleEvaluationController: RuleEvaluationController;
};

export function registerValidationDomain(
  container: AwilixContainer<ValidationDomainCradle>,
): void {
  container.register({
    evaluationFactReader: asFunction(createEvaluationFactReader).singleton(),
    assertionLogReader: asFunction(createAssertionLogReader).singleton(),
    evaluationGraphRepository: asFunction(
      createEvaluationGraphRepository,
    ).singleton(),
    graphProjector: asFunction(createGraphProjector).singleton(),
    graphProjectorConsumer: asFunction(createGraphProjectorConsumer).singleton(),
    ruleEvaluationService: asFunction(createRuleEvaluationService).singleton(),
    ruleEvaluationController: asFunction(
      createRuleEvaluationController,
    ).singleton(),
  });
}
