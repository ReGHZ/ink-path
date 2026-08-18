import { describe, expect, it } from "vitest";

import {
  aggregateOutcomes,
  evaluateRule,
  outcomeOf,
  type EvaluationSnapshot,
} from "./RuleEvaluator.js";

import type { EntityType, RuleAst } from "./ruleAst.js";
import type { StoryPosition } from "./storyPosition.js";

// The three rows locked in `notes/phase-11-validation.md` BEFORE this evaluator
// was written, plus one regression test per blocker the 2026-08-18 quality gate
// found. Those four are grouped at the bottom under the failure they share:
// every one of them answered `valid` for a question the engine had not actually
// decided.
//
// Canonical rule (a) — "died in chapter 12, speaks in chapter 30". Its AST was
// written and accepted in the pass-3 quality gate
// (`notes/gerbang-mutu-revisi-dokumen-2026-08-17.md:589-611`), and it takes the
// `at` route rather than `count` or `select_*`, so neither of the two open
// semantic questions from the 2026-08-18 gate stands in its way.

const DEAD = "00000000-0000-4000-8000-0000000000d0";
const APPEARS_IN = "00000000-0000-4000-8000-0000000000a0";
const RESURRECTED = "00000000-0000-4000-8000-0000000000e0";

const CHARACTER = "char-1";

const ENUMERABLE: readonly EntityType[] = ["character", "scene", "chapter"];

const PREDICATES = [
  { id: DEAD, objectRequired: false },
  { id: APPEARS_IN, objectRequired: true },
  { id: RESURRECTED, objectRequired: false },
];

const rule: RuleAst = {
  version: "1",
  bindings: [
    { name: "char", entity_type: "character", quantifier: "exists" },
    { name: "sc", entity_type: "scene", quantifier: "exists" },
  ],
  condition: {
    type: "and",
    conditions: [
      {
        type: "relation_atom",
        subject: "char",
        predicate_ref: { type: "predicate_ref", definition_id: APPEARS_IN },
        object: "sc",
      },
      {
        type: "relation_atom",
        subject: "char",
        predicate_ref: { type: "predicate_ref", definition_id: DEAD },
        at: { binding: "sc" },
      },
    ],
  },
  severity: "error",
  message_template: "{{char.name}} muncul di {{sc.title}} padahal sudah mati",
};

function scenePosition(
  chapterOrder: number,
  orderInChapter = 0,
): StoryPosition {
  return { kind: "scene", chapterOrder, orderInChapter };
}

function chapterPosition(chapterOrder: number): StoryPosition {
  return { kind: "chapter", chapterOrder };
}

function worldWhere({
  scenePlace,
  deathPlace,
  terminated = false,
}: {
  scenePlace: StoryPosition;
  deathPlace: StoryPosition | null;
  terminated?: boolean;
}): EvaluationSnapshot {
  return {
    enumerableEntityTypes: ENUMERABLE,
    predicates: PREDICATES,
    entities: [
      { id: CHARACTER, entityType: "character", position: null },
      { id: "scene-1", entityType: "scene", position: scenePlace },
    ],
    assertions: [
      {
        definitionId: APPEARS_IN,
        subjectEntityId: CHARACTER,
        objectEntityId: "scene-1",
        anchorPosition: null,
        terminated: false,
      },
      {
        definitionId: DEAD,
        subjectEntityId: CHARACTER,
        objectEntityId: null,
        anchorPosition: deathPlace,
        terminated,
      },
    ],
  };
}

describe("rule evaluation — the three locked criteria", () => {
  it("answers conflict when the character speaks after dying", () => {
    expect(
      evaluateRule(
        rule,
        worldWhere({
          deathPlace: chapterPosition(12),
          scenePlace: scenePosition(30),
        }),
      ),
    ).toBe("conflict");
  });

  it("answers valid when the scene comes before the death", () => {
    expect(
      evaluateRule(
        rule,
        worldWhere({
          deathPlace: chapterPosition(12),
          scenePlace: scenePosition(5),
        }),
      ),
    ).toBe("valid");
  });

  it("answers unsupported when the death cannot be placed against the scene", () => {
    expect(
      evaluateRule(
        rule,
        worldWhere({ deathPlace: null, scenePlace: scenePosition(30) }),
      ),
    ).toBe("unsupported");
  });
});

describe("rule evaluation — ordering", () => {
  // Two exact positions inside one chapter ARE comparable, and the data to do
  // it (`scenes.order_in_chapter`) has existed all along. An earlier version
  // gave every scene its chapter's order and nothing else, so this world came
  // back `valid` — a contradiction inside a single chapter reported as clean.
  it("orders two scenes within the same chapter", () => {
    expect(
      evaluateRule(
        rule,
        worldWhere({
          deathPlace: scenePosition(30, 1),
          scenePlace: scenePosition(30, 5),
        }),
      ),
    ).toBe("conflict");
  });

  it("does not treat a later scene in the same chapter as already past", () => {
    expect(
      evaluateRule(
        rule,
        worldWhere({
          deathPlace: scenePosition(30, 5),
          scenePlace: scenePosition(30, 1),
        }),
      ),
    ).toBe("valid");
  });

  // "He died in chapter 30" says nothing about WHERE in chapter 30, so against a
  // scene inside chapter 30 the question is genuinely open. `unsupported` is the
  // honest answer; `valid` would turn the engine's imprecision into a claim
  // about the manuscript.
  it("answers unsupported for a chapter anchor against a scene in that chapter", () => {
    expect(
      evaluateRule(
        rule,
        worldWhere({
          deathPlace: chapterPosition(30),
          scenePlace: scenePosition(30, 5),
        }),
      ),
    ).toBe("unsupported");
  });

  it("answers valid when nothing was ever asserted dead", () => {
    expect(
      evaluateRule(rule, {
        enumerableEntityTypes: ENUMERABLE,
        predicates: PREDICATES,
        entities: [
          { id: CHARACTER, entityType: "character", position: null },
          { id: "scene-1", entityType: "scene", position: scenePosition(30) },
        ],
        assertions: [
          {
            definitionId: APPEARS_IN,
            subjectEntityId: CHARACTER,
            objectEntityId: "scene-1",
            anchorPosition: null,
            terminated: false,
          },
        ],
      }),
    ).toBe("valid");
  });

  it("answers unsupported when the death was terminated", () => {
    expect(
      evaluateRule(
        rule,
        worldWhere({
          deathPlace: chapterPosition(12),
          scenePlace: scenePosition(30),
          terminated: true,
        }),
      ),
    ).toBe("unsupported");
  });

  it("finds the offending scene among several", () => {
    const world = worldWhere({
      deathPlace: chapterPosition(12),
      scenePlace: scenePosition(5),
    });

    expect(
      evaluateRule(rule, {
        ...world,
        entities: [
          ...world.entities,
          { id: "scene-2", entityType: "scene", position: scenePosition(30) },
        ],
        assertions: [
          ...world.assertions,
          {
            definitionId: APPEARS_IN,
            subjectEntityId: CHARACTER,
            objectEntityId: "scene-2",
            anchorPosition: null,
            terminated: false,
          },
        ],
      }),
    ).toBe("conflict");
  });
});

// Every test below reproduces a way the engine used to answer `valid` for a
// question it had not decided. They share one shape: AN EMPTY RESULT READ AS A
// NEGATIVE ANSWER. Nothing matched and nothing could have matched are not the
// same answer, and only the first one is about the manuscript.
describe("rule evaluation — gaps must answer unsupported, never valid", () => {
  // An exception belongs to the assignment that raised it. Folding condition
  // and `unless` separately across all assignments let a resurrection recorded
  // for one character excuse a plot hole belonging to another — and one
  // resurrection anywhere in a project switched the rule off for everyone.
  it("does not let one character's exception excuse another's contradiction", () => {
    const ruleWithException: RuleAst = {
      ...rule,
      unless: {
        type: "relation_atom",
        subject: "char",
        predicate_ref: { type: "predicate_ref", definition_id: RESURRECTED },
      },
    };

    const world: EvaluationSnapshot = {
      enumerableEntityTypes: ENUMERABLE,
      predicates: PREDICATES,
      entities: [
        { id: "alice", entityType: "character", position: null },
        { id: "bob", entityType: "character", position: null },
        { id: "scene-1", entityType: "scene", position: scenePosition(30) },
      ],
      assertions: [
        // Alice: dead, appears afterwards, never resurrected → a real plot hole.
        {
          definitionId: APPEARS_IN,
          subjectEntityId: "alice",
          objectEntityId: "scene-1",
          anchorPosition: null,
          terminated: false,
        },
        {
          definitionId: DEAD,
          subjectEntityId: "alice",
          objectEntityId: null,
          anchorPosition: chapterPosition(12),
          terminated: false,
        },
        // Bob: resurrected, and his own appearance is therefore excused.
        {
          definitionId: RESURRECTED,
          subjectEntityId: "bob",
          objectEntityId: null,
          anchorPosition: null,
          terminated: false,
        },
      ],
    };

    expect(evaluateRule(ruleWithException, world)).toBe("conflict");
  });

  it("still lets an exception excuse the character it belongs to", () => {
    const ruleWithException: RuleAst = {
      ...rule,
      unless: {
        type: "relation_atom",
        subject: "char",
        predicate_ref: { type: "predicate_ref", definition_id: RESURRECTED },
      },
    };

    const world = worldWhere({
      deathPlace: chapterPosition(12),
      scenePlace: scenePosition(30),
    });

    expect(
      evaluateRule(ruleWithException, {
        ...world,
        assertions: [
          ...world.assertions,
          {
            definitionId: RESURRECTED,
            subjectEntityId: CHARACTER,
            objectEntityId: null,
            anchorPosition: null,
            terminated: false,
          },
        ],
      }),
    ).toBe("valid");
  });

  // Six of the grammar's nine entity types are not enumerated by any reader
  // yet. A binding over one of them used to produce zero candidates, and zero
  // candidates produced `valid` — the engine reporting a clean manuscript
  // without having looked at a single faction.
  it("answers unsupported for a binding the snapshot cannot enumerate", () => {
    const factionRule: RuleAst = {
      ...rule,
      bindings: [
        { name: "char", entity_type: "faction", quantifier: "exists" },
        { name: "sc", entity_type: "scene", quantifier: "exists" },
      ],
    };

    expect(
      evaluateRule(
        factionRule,
        worldWhere({
          deathPlace: chapterPosition(12),
          scenePlace: scenePosition(30),
        }),
      ),
    ).toBe("unsupported");
  });

  it("still answers valid for a type it CAN enumerate that happens to be empty", () => {
    // The distinction the previous test turns on: a project with no characters
    // genuinely cannot contradict itself, and that answer must survive.
    expect(
      evaluateRule(rule, {
        enumerableEntityTypes: ENUMERABLE,
        predicates: PREDICATES,
        entities: [],
        assertions: [],
      }),
    ).toBe("valid");
  });

  // Safety rule 3. A wrong-arity atom matches no assertion at all, so without
  // the check a typo in a rule produced a confident `valid`.
  it("answers unsupported when an atom uses a predicate at the wrong arity", () => {
    const wrongArity: RuleAst = {
      ...rule,
      condition: {
        type: "relation_atom",
        subject: "char",
        // `dead` is unary; handing it an object makes it match nothing.
        predicate_ref: { type: "predicate_ref", definition_id: DEAD },
        object: "sc",
      },
    };

    expect(
      evaluateRule(
        wrongArity,
        worldWhere({
          deathPlace: chapterPosition(12),
          scenePlace: scenePosition(30),
        }),
      ),
    ).toBe("unsupported");
  });

  it("answers unsupported for a predicate the project does not define", () => {
    const unknownPredicate: RuleAst = {
      ...rule,
      condition: {
        type: "relation_atom",
        subject: "char",
        predicate_ref: {
          type: "predicate_ref",
          definition_id: "00000000-0000-4000-8000-00000000ffff",
        },
      },
    };

    expect(
      evaluateRule(
        unknownPredicate,
        worldWhere({
          deathPlace: chapterPosition(12),
          scenePlace: scenePosition(30),
        }),
      ),
    ).toBe("unsupported");
  });

  it("answers unsupported for grammar this slice does not evaluate", () => {
    const withForall: RuleAst = {
      ...rule,
      bindings: [
        { name: "char", entity_type: "character", quantifier: "forall" },
        { name: "sc", entity_type: "scene", quantifier: "exists" },
      ],
    };

    expect(
      evaluateRule(
        withForall,
        worldWhere({
          deathPlace: chapterPosition(12),
          scenePlace: scenePosition(30),
        }),
      ),
    ).toBe("unsupported");
  });
});

describe("outcome table", () => {
  // Exhaustive 3×3. The property worth reading off it: `conflict` appears
  // exactly once, and only where both inputs are certain. No path from
  // ignorance reaches it.
  it.each([
    ["true", "false", "conflict"],
    ["true", "true", "valid"],
    ["true", "unknown", "unsupported"],
    ["false", "false", "valid"],
    ["false", "true", "valid"],
    ["false", "unknown", "valid"],
    ["unknown", "false", "unsupported"],
    ["unknown", "true", "valid"],
    ["unknown", "unknown", "unsupported"],
  ] as const)(
    "condition=%s unless=%s → %s",
    (condition, exception, expected) => {
      expect(outcomeOf(condition, exception)).toBe(expected);
    },
  );

  it("reaches conflict from exactly one of the nine cells", () => {
    const truths = ["true", "false", "unknown"] as const;
    const conflicts = truths.flatMap((condition) =>
      truths.filter(
        (exception) => outcomeOf(condition, exception) === "conflict",
      ),
    );

    expect(conflicts).toHaveLength(1);
  });
});

describe("aggregating outcomes across assignments", () => {
  // One unexcused contradiction is a contradiction whatever the rest of the
  // project looks like; an undecided assignment only matters when nothing is in
  // conflict, and then it matters.
  it("lets a single conflict win over anything else", () => {
    expect(aggregateOutcomes(["valid", "unsupported", "conflict"])).toBe(
      "conflict",
    );
  });

  it("reports unsupported when nothing conflicts but something is undecided", () => {
    expect(aggregateOutcomes(["valid", "unsupported", "valid"])).toBe(
      "unsupported",
    );
  });

  it("reports valid only when every assignment is valid", () => {
    expect(aggregateOutcomes(["valid", "valid"])).toBe("valid");
  });

  it("reports valid for no assignments at all", () => {
    expect(aggregateOutcomes([])).toBe("valid");
  });
});

function crowdedWorld(perType: number): EvaluationSnapshot {
  const entities = [];

  for (let index = 0; index < perType; index += 1) {
    entities.push({
      id: `char-${index}`,
      entityType: "character" as const,
      position: null,
    });
    entities.push({
      id: `scene-${index}`,
      entityType: "scene" as const,
      position: scenePosition(index),
    });
  }

  return {
    enumerableEntityTypes: ENUMERABLE,
    predicates: PREDICATES,
    entities,
    assertions: [],
  };
}

// B-11 (`quality-gate/gerbang-mutu-phase-11-slice-pass2-2026-08-18.md`). The
// product of the bindings is the engine's only unbounded quantity, and it is an
// EXPONENT of the project's size, so the two tests below pin the ceiling from
// both sides. They are deliberately one entity apart: dropping the ceiling makes
// the first one red, raising it makes the second one red, and deleting the check
// altogether makes the second one red as well. A one-sided test would have let
// the number drift silently in either direction.
describe("rule evaluation — the enumeration budget", () => {
  // 100 x 100 = 10_000, exactly the budget. It is answered, and the answer is
  // the real one: nothing is asserted, so nothing contradicts.
  it("still answers when the product lands exactly on the budget", () => {
    expect(evaluateRule(rule, crowdedWorld(100))).toBe("valid");
  });

  // 101 x 101 = 10_201. One entity more, and the engine refuses to enumerate
  // instead of trying. `unsupported`, never `valid` — the whole file's rule: a
  // product the engine declined to build is not a project without contradictions.
  it("answers unsupported when the product outgrows the budget", () => {
    expect(evaluateRule(rule, crowdedWorld(101))).toBe("unsupported");
  });
});
