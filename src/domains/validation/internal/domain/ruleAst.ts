// Transcription of the rule AST grammar frozen in
// `02-system-design/07_validation_ast_schema.md:29-131`.
//
// That block was cleared for transcription by name: the 2026-08-18 quality gate
// (`notes/gerbang-mutu-ast-schema-2026-08-18.md`) rejected the document as a
// whole but carved this out, because every one of its findings sits in the
// EVALUATION PROSE, the worked examples, or other documents — not in the type
// block, which is self-consistent. What that carve-out does NOT clear, and what
// therefore must not be read out of this file: the "Semantik per node" section
// as an evaluator specification, Example 1 as a fixture, and `attr` as the
// reader of unary facts.
//
// Kept as a faithful copy rather than a convenient subset. A grammar that is
// transcribed selectively stops being the same grammar, and the point of having
// it in TypeScript is that the compiler — not a reviewer — is what checks a rule
// against it from here on.
//
// THREE TYPE NAMES ARE SPELLED OUT where the document abbreviates, because the
// repository's lint forbids the abbreviations and there is not one
// `eslint-disable` anywhere in `src/` to follow as precedent. Reading this file
// against the document means applying:
//
//   document        here
//   ------------    ------------------
//   BooleanExpr  →  BooleanExpression
//   PredicateRef →  PredicateReference
//   ParamRef     →  ParameterReference
//
// The WIRE names are untouched — `predicate_ref`, `param_ref`, `relation_atom`
// and every other string literal are the serialised form a stored rule is
// written in, so renaming those would change the data, not the vocabulary.

export type EntityType =
  | "character"
  | "event"
  | "scene"
  | "chapter"
  | "faction"
  | "world_element"
  | "plot"
  | "map"
  | "layer";

export type RuleAst = {
  version: "1";
  bindings: Binding[];
  condition: BooleanExpression;
  // Exception clause — first class, not sugar. Absent is equivalent to `false`
  // (`07:155`): a rule with no exception has nothing that could excuse it.
  unless?: BooleanExpression;
  severity: "error" | "warning" | "info";
  message_template: string;
};

export type Binding = {
  name: string;
  entity_type: EntityType;
  quantifier: "exists" | "forall";
  where?: BooleanExpression;
};

export type BooleanExpression =
  | { type: "and"; conditions: BooleanExpression[] }
  | { type: "or"; conditions: BooleanExpression[] }
  | { type: "not"; condition: BooleanExpression }
  | Predicate
  | RelationAtom
  | TemporalPredicate;

// Named `relation_atom` rather than `predicate` on purpose: `Predicate` below is
// already the VALUE COMPARISON node. This one is a fact atom, and conflating the
// two is the mistake an earlier draft of the document made.
export type RelationAtom = {
  type: "relation_atom";
  subject: string;
  predicate_ref: PredicateReference | ParameterReference;
  // Present if and only if the definition says `objectRequired` (safety rule 3).
  object?: string;
  // Story-time cut. Absent = the "holds now" fold; present = fold up to the cut
  // of that anchor binding.
  at?: { binding: string };
};

export type PredicateReference = {
  type: "predicate_ref";
  definition_id: string;
};

// Only ever legal inside `ast_template`, never in `rules.ast` (safety rule 4).
export type ParameterReference = {
  type: "param_ref";
  name: string;
};

export type Predicate = {
  type: "predicate";
  left: Expression;
  operator: ComparisonOperator;
  right: Expression;
};

export type ComparisonOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "greater_than_or_eq"
  | "less_than_or_eq"
  | "contains"
  | "not_contains";

// `before`/`after` live here rather than in ComparisonOperator because their
// operands are not arbitrary Expressions. While they were, `constant(5) after
// count(...)` passed validation and meant nothing.
export type TemporalPredicate = {
  type: "temporal_predicate";
  left: TemporalOperand;
  operator: "before" | "after";
  right: TemporalOperand;
};

// Only a story anchor can be reached along the order. The named binding's
// `entity_type` must be one of scene / event / chapter.
export type TemporalOperand = { type: "anchor"; binding: string };

export type Expression =
  | { type: "constant"; value: string | number | boolean | null }
  | { type: "attr"; binding: string; attribute: string }
  | { type: "count"; of: EntityQuery }
  | { type: "select_latest"; of: EntityQuery; order_by: OrderAxis }
  | { type: "select_first"; of: EntityQuery; order_by: OrderAxis };

// Two axes, two behaviours — not one of them banned.
//   artifact : TOTAL   → the extremum is always defined.
//   diegetic : PARTIAL → the extremum may not be unique, so the answer is
//                        `unknown`.
export type OrderAxis =
  | { axis: "artifact"; field: "chapter_order" | "scene_order_in_chapter" }
  | { axis: "diegetic" };

export type EntityQuery = {
  entity_type: EntityType;
  as: string;
  where?: BooleanExpression;
};
