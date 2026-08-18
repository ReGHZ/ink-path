import type { EvaluationSnapshot } from "./RuleEvaluator.js";

// The contract lives here and the Postgres implementation lives in
// `infrastructure/`, the same split as `TransitionEffectRepository` against
// `PrismaTransitionEffectRepository` (`notes/02-struktur-domain-dan-test.md`:
// repository interface → `domain/`, impl → `infrastructure/`).
//
// It matters more than usual here: `evaluateRule` decides what a rule ANSWERS,
// and an evaluator that could only be exercised against a live database would
// make every question about its reasoning a question about a fixture. With the
// read behind this port the same reasoning is testable on a hand-built world,
// and any disagreement between that and the database is a reader bug rather
// than an evaluation bug.
export type EvaluationFactReader = {
  read(projectId: string): Promise<EvaluationSnapshot>;
};
