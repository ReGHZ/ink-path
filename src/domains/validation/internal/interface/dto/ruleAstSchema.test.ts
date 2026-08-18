import { describe, expect, it } from "vitest";

import { ruleAstSchema } from "./ruleAstSchema.js";

// The arity cap from B-11, tested here rather than end-to-end because it is the
// boundary itself that is under test: the evaluator raises the project's entity
// count TO the number of bindings, so an unbounded array here is an unbounded
// exponent there. Two tests, one entity apart, so the cap cannot be widened or
// removed without one of them going red.

function ruleWith(bindingCount: number) {
  return {
    version: "1",
    bindings: Array.from({ length: bindingCount }, (_unused, index) => ({
      name: `b${index}`,
      entity_type: "character",
      quantifier: "exists",
    })),
    condition: {
      type: "relation_atom",
      subject: "b0",
      predicate_ref: {
        type: "predicate_ref",
        definition_id: "00000000-0000-4000-8000-0000000000d0",
      },
    },
    severity: "error",
    message_template: "x",
  };
}

describe("ruleAstSchema — binding arity", () => {
  // Four is the widest the frozen canon needs (rule (c): character x item x
  // scene, plus one slot of headroom).
  it("accepts a rule at the cap", () => {
    expect(ruleAstSchema.safeParse(ruleWith(4)).success).toBe(true);
  });

  it("refuses a rule one binding over the cap", () => {
    expect(ruleAstSchema.safeParse(ruleWith(5)).success).toBe(false);
  });
});
