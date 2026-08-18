import { evaluateRule, type RuleOutcome } from "../domain/RuleEvaluator.js";

import type { EvaluationFactReader } from "../domain/EvaluationFactReader.js";
import type { RuleAst } from "../domain/ruleAst.js";

// Thin by design: read the world, hand it to the evaluator, return the answer.
// Every decision worth arguing about lives in `domain/`, which is why this file
// has no branches — a service that started deciding outcomes would put the
// reasoning somewhere a unit test has to reach through a database to see.
//
// One snapshot per evaluation, taken once. A rule that read the world twice
// could see it change mid-evaluation and answer about a world that never
// existed; `evaluateRule` is pure precisely so that cannot happen.
export class RuleEvaluationService {
  constructor(private readonly evaluationFactReader: EvaluationFactReader) {}

  async evaluate(projectId: string, ast: RuleAst): Promise<RuleOutcome> {
    const snapshot = await this.evaluationFactReader.read(projectId);

    return evaluateRule(ast, snapshot);
  }
}

export function createRuleEvaluationService({
  evaluationFactReader,
}: {
  evaluationFactReader: EvaluationFactReader;
}): RuleEvaluationService {
  return new RuleEvaluationService(evaluationFactReader);
}
