import { strictlyBefore, type StoryPosition } from "./storyPosition.js";
import { and, fromBoolean, not, or, type Truth } from "./threeValued.js";

import type {
  Binding,
  BooleanExpression,
  EntityType,
  RelationAtom,
  RuleAst,
} from "./ruleAst.js";

// The thin vertical slice: one predicate → assertions → one rule → one answer
// (`notes/premis-symbolic-rule-engine.md` §8b step 3).
//
// Pure on purpose. Everything the evaluator can see arrives in the snapshot, so
// the same reasoning can be tested with a hand-built world and with one read out
// of Postgres, and a disagreement between the two is a reader bug rather than an
// evaluation bug.
//
// EVERY GAP IN THE ENGINE ANSWERS `unknown`, NEVER `false`. That is not a
// shortcut standing in for real support — it is the designed baseline (K3):
// anything the rule engine cannot decide becomes `unsupported` and falls through
// to the AI path. Answering `false` for something this evaluator does not handle
// would manufacture a clean bill of health out of a gap in the engine, which is
// the single failure mode the design names as most damaging.
//
// The 2026-08-18 quality gate found three separate doors into exactly that
// failure, all of them past the two this file was already guarding (unhandled
// NODES and unhandled QUANTIFIERS). The three it found:
//
//   · a binding whose entity type the reader never emits — closed by
//     `enumerableEntityTypes` below;
//   · a predicate reference the project has no definition for, or used at the
//     wrong arity — closed by the definition lookup in `evaluateRelationAtom`;
//   · two positions that cannot be ordered — closed by `strictlyBefore`
//     returning `unknown` rather than collapsing to `<`.
//
// The pattern behind all three: an EMPTY RESULT read as a NEGATIVE ANSWER.
// Nothing matched and nothing could have matched are different answers.

export type RuleOutcome = "conflict" | "valid" | "unsupported";

export type EvaluationEntity = {
  id: string;
  entityType: EntityType;
  // Where this entity sits on the ordering, or null when it cannot be placed on
  // it at all. Null is a first-class answer, not a missing value.
  position: StoryPosition | null;
};

export type EvaluationAssertion = {
  definitionId: string;
  subjectEntityId: string;
  objectEntityId: string | null;
  // Story position of this assertion's anchor. Null covers two situations the
  // reader has collapsed on purpose — no anchor at all, and an anchor that
  // cannot be ordered — because both mean the same thing to a cut comparison:
  // it cannot be decided.
  anchorPosition: StoryPosition | null;
  // Some `terminate` names this assertion. Termination is valid-time: the fact
  // held before that anchor and stops after it, so deciding it needs the
  // terminating anchor compared against the cut — reasoning this slice does not
  // implement. Until it does, a terminated assertion answers `unknown` rather
  // than being read as still holding, which would be a wrong answer rather than
  // an absent one.
  terminated: boolean;
};

// Just enough of a predicate definition to check that a rule uses it the way
// the project declared it. The full row lives in `relationship_definitions`.
export type EvaluationPredicate = {
  id: string;
  objectRequired: boolean;
};

export type EvaluationSnapshot = {
  // Which entity types this snapshot actually enumerates. Anything outside the
  // list is a question the snapshot cannot answer, and saying so is the whole
  // point: without it, a binding over `faction` produced zero candidates, zero
  // candidates produced `false`, and `false` produced a clean `valid` from an
  // engine that had never looked at a single faction.
  enumerableEntityTypes: readonly EntityType[];
  entities: readonly EvaluationEntity[];
  predicates: readonly EvaluationPredicate[];
  assertions: readonly EvaluationAssertion[];
};

type Assignment = ReadonlyMap<string, EvaluationEntity>;

export function evaluateRule(
  ast: RuleAst,
  snapshot: EvaluationSnapshot,
): RuleOutcome {
  const assignments = enumerateAssignments(ast.bindings, snapshot);

  if (assignments === null) {
    return "unsupported";
  }

  const exception = ast.unless;

  // PER ASSIGNMENT, then aggregate. Condition and exception have to be decided
  // together for one and the same assignment: an earlier version folded each
  // across all assignments separately, so a resurrection recorded for ONE
  // character excused a plot hole belonging to ANOTHER. The pairing is the
  // information that folding first destroys.
  const outcomes = assignments.map((assignment) =>
    outcomeOf(
      evaluateBoolean(ast.condition, assignment, snapshot),
      // Absent `unless` is equivalent to `false` (`07:155`): a rule with no
      // exception has nothing that could excuse the finding.
      exception === undefined
        ? "false"
        : evaluateBoolean(exception, assignment, snapshot),
    ),
  );

  return aggregateOutcomes(outcomes);
}

// One unexcused contradiction is a contradiction, whatever the rest of the
// project looks like. Only when nothing is in conflict does an undecided
// assignment matter — and then it matters, because "clean" would be a claim the
// engine has not earned.
//
// No assignments at all yields `valid`, and that is correct rather than
// convenient: a project with no characters cannot contradict itself. It is only
// wrong when the emptiness came from the engine not looking, which is why
// `enumerateAssignments` refuses those cases outright instead of returning [].
export function aggregateOutcomes(
  outcomes: readonly RuleOutcome[],
): RuleOutcome {
  if (outcomes.includes("conflict")) {
    return "conflict";
  }

  return outcomes.includes("unsupported") ? "unsupported" : "valid";
}

// The 3×3 table from `07`, in the order that matters, for ONE assignment.
//
// A definitely-true exception is checked FIRST and answers `valid` even when the
// condition is unknown. That is not an optimisation: if the exception certainly
// applies, the rule cannot fire whatever the condition turns out to be, so
// reporting `unsupported` there would spend an AI call to answer a question
// already settled — against the very reason this engine exists.
//
// Nothing else reaches `conflict`. It requires the condition definitely true AND
// the exception definitely false; no path from ignorance leads to it.
export function outcomeOf(
  conditionTruth: Truth,
  unlessTruth: Truth,
): RuleOutcome {
  if (unlessTruth === "true") {
    return "valid";
  }

  if (conditionTruth === "false") {
    return "valid";
  }

  if (conditionTruth === "true" && unlessTruth === "false") {
    return "conflict";
  }

  return "unsupported";
}

// The enumeration below materialises the WHOLE cartesian product of the
// bindings before a single atom is looked at, and nothing in the grammar bounds
// it: k bindings over a project holding n entities of each type is n^k maps, in
// one single-threaded process. Five bindings over 200 characters is 3.2e11.
//
// So the product is budgeted, and going over budget is REFUSED rather than
// attempted. That refusal belongs to the same family as the three doors above:
// the engine did not look, so it must not answer `valid`. `unsupported` is the
// honest answer, and the AI path already receives it.
//
// The number is a ceiling, not a tuning. 10_000 assignments each doing a linear
// scan of the snapshot is already the edge of what belongs inside a synchronous
// request. RAISING it later is backwards-compatible — a rule that answered
// `unsupported` starts answering. LOWERING it is not: rules that were answered
// go quiet. Its real replacement is `where` pre-filtering on bindings, which is
// grammar this slice does not evaluate yet.
const MAX_ASSIGNMENTS = 10_000;

// Returns null when a binding names something this snapshot cannot enumerate or
// when the product outgrows the budget, both of which the caller turns into
// `unsupported`.
function enumerateAssignments(
  bindings: readonly Binding[],
  snapshot: EvaluationSnapshot,
): Assignment[] | null {
  let assignments: Assignment[] = [new Map()];

  for (const binding of bindings) {
    // `forall` and pre-filtered bindings are grammar this slice does not
    // evaluate yet. Refusing to enumerate is what routes them to `unsupported`
    // instead of quietly evaluating a different rule than the one written.
    if (binding.quantifier !== "exists" || binding.where !== undefined) {
      return null;
    }

    // The entity type is one the snapshot does not carry. Distinct from "it
    // carries that type and found none" — the first is the engine's blind spot,
    // the second is a fact about the project.
    if (!snapshot.enumerableEntityTypes.includes(binding.entity_type)) {
      return null;
    }

    const candidates = snapshot.entities.filter(
      (entity) => entity.entityType === binding.entity_type,
    );

    // Checked BEFORE the product is built, never after — the whole point is to
    // not allocate it. Zero candidates is NOT over budget: an enumerable type
    // that holds no entities is a fact about the project, and it keeps the
    // empty-assignment `valid` that `aggregateOutcomes` documents.
    if (assignments.length * candidates.length > MAX_ASSIGNMENTS) {
      return null;
    }

    const extended: Assignment[] = [];

    for (const assignment of assignments) {
      for (const candidate of candidates) {
        const next = new Map(assignment);
        next.set(binding.name, candidate);
        extended.push(next);
      }
    }

    assignments = extended;
  }

  return assignments;
}

function evaluateBoolean(
  expression: BooleanExpression,
  assignment: Assignment,
  snapshot: EvaluationSnapshot,
): Truth {
  switch (expression.type) {
    case "and":
      return and(
        expression.conditions.map((condition) =>
          evaluateBoolean(condition, assignment, snapshot),
        ),
      );

    case "or":
      return or(
        expression.conditions.map((condition) =>
          evaluateBoolean(condition, assignment, snapshot),
        ),
      );

    case "not":
      return not(evaluateBoolean(expression.condition, assignment, snapshot));

    case "relation_atom":
      return evaluateRelationAtom(expression, assignment, snapshot);

    // Value comparison and temporal comparison are grammar this slice does not
    // implement. See the note at the top: the answer is `unknown`, never
    // `false`.
    case "predicate":
    case "temporal_predicate":
      return "unknown";
  }
}

function evaluateRelationAtom(
  atom: RelationAtom,
  assignment: Assignment,
  snapshot: EvaluationSnapshot,
): Truth {
  // A `ParameterReference` in an evaluated rule is a template that was never
  // instantiated (safety rule 4). Unknown rather than an exception: a malformed
  // rule should degrade to "cannot decide", not take down the evaluation of
  // every other rule in the request.
  if (atom.predicate_ref.type !== "predicate_ref") {
    return "unknown";
  }

  // Read out here rather than inside the closures below: the narrowing above
  // does not survive into one.
  const definitionId = atom.predicate_ref.definition_id;

  const definition = snapshot.predicates.find(
    (predicate) => predicate.id === definitionId,
  );

  // The project has no such predicate — a rule written against another
  // project's vocabulary, or against one since deleted. Nothing can match it,
  // but "nothing matched" would read as a clean answer about a question the
  // engine never understood.
  if (definition === undefined) {
    return "unknown";
  }

  // Safety rule 3: `object` is present if and only if the definition says
  // `objectRequired`. A wrong-arity atom matches no assertion at all, so
  // without this check a typo in a rule produces a confident `valid`.
  if ((atom.object !== undefined) !== definition.objectRequired) {
    return "unknown";
  }

  const subject = assignment.get(atom.subject);

  if (subject === undefined) {
    return "unknown";
  }

  const object =
    atom.object === undefined ? undefined : assignment.get(atom.object);

  if (atom.object !== undefined && object === undefined) {
    return "unknown";
  }

  const matching = snapshot.assertions.filter(
    (assertion) =>
      assertion.definitionId === definitionId &&
      assertion.subjectEntityId === subject.id &&
      assertion.objectEntityId === (object?.id ?? null),
  );

  // No cut: the "holds now" fold. Presence in the log settles it either way —
  // unless something terminated it, which this slice cannot place in time.
  if (atom.at === undefined) {
    if (matching.some((assertion) => assertion.terminated)) {
      return "unknown";
    }

    return fromBoolean(matching.length > 0);
  }

  const anchor = assignment.get(atom.at.binding);
  const cut = anchor?.position ?? null;

  // The cut itself cannot be placed on the ordering, so no assertion can be
  // compared against it.
  if (cut === null) {
    return "unknown";
  }

  // An atom with a cut and nothing asserted is definitely false — the absence
  // is complete information here, unlike an assertion whose anchor cannot be
  // ordered.
  if (matching.length === 0) {
    return "false";
  }

  return or(
    matching.map((assertion) =>
      assertion.anchorPosition === null || assertion.terminated
        ? "unknown"
        : strictlyBefore(assertion.anchorPosition, cut),
    ),
  );
}
