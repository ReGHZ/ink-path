import { describe, expect, it } from "vitest";

import { createRuleEvaluationService } from "./RuleEvaluationService.js";

import type { EvaluationFactReader } from "../domain/EvaluationFactReader.js";
import type { RuleAst } from "../domain/ruleAst.js";
import type { EvaluationSnapshot } from "../domain/RuleEvaluator.js";

// The service holds no reasoning, so what is worth asserting here is the wiring:
// the project id reaches the reader, and the world is read once per evaluation.
// The second one is not fussiness — a rule that read the world twice could see
// it change between reads and answer about a world that never existed.

const DEAD = "00000000-0000-4000-8000-0000000000d0";

const emptyWorld: EvaluationSnapshot = {
  enumerableEntityTypes: ["character", "scene", "chapter"],
  entities: [],
  predicates: [{ id: DEAD, objectRequired: false }],
  assertions: [],
};

const rule: RuleAst = {
  version: "1",
  bindings: [{ name: "char", entity_type: "character", quantifier: "exists" }],
  condition: {
    type: "relation_atom",
    subject: "char",
    predicate_ref: { type: "predicate_ref", definition_id: DEAD },
  },
  severity: "error",
  message_template: "…",
};

function stubReader(snapshot: EvaluationSnapshot) {
  const projectIds: string[] = [];

  const reader: EvaluationFactReader = {
    read(projectId) {
      projectIds.push(projectId);

      return Promise.resolve(snapshot);
    },
  };

  return { reader, projectIds };
}

describe("RuleEvaluationService", () => {
  it("reads the world of the project it was asked about, exactly once", async () => {
    const { reader, projectIds } = stubReader(emptyWorld);
    const service = createRuleEvaluationService({
      evaluationFactReader: reader,
    });

    await service.evaluate("project-1", rule);

    expect(projectIds).toEqual(["project-1"]);
  });

  it("returns the evaluator's answer unchanged", async () => {
    const { reader } = stubReader({
      enumerableEntityTypes: ["character", "scene", "chapter"],
      predicates: [{ id: DEAD, objectRequired: false }],
      entities: [{ id: "char-1", entityType: "character", position: null }],
      assertions: [
        {
          definitionId: DEAD,
          subjectEntityId: "char-1",
          objectEntityId: null,
          anchorPosition: null,
          terminated: false,
        },
      ],
    });
    const service = createRuleEvaluationService({
      evaluationFactReader: reader,
    });

    // condition true, no `unless` — the one cell that reaches conflict.
    await expect(service.evaluate("project-1", rule)).resolves.toBe("conflict");
  });

  it("answers valid on an empty world rather than failing", async () => {
    const { reader } = stubReader(emptyWorld);
    const service = createRuleEvaluationService({
      evaluationFactReader: reader,
    });

    // No bindings can be assigned, so nothing satisfies the rule. `valid` is
    // the honest answer: a project with no characters cannot contradict itself.
    await expect(service.evaluate("project-1", rule)).resolves.toBe("valid");
  });
});
