import { z } from "zod";

import type {
  BooleanExpression,
  EntityQuery,
  Expression,
  RuleAst,
} from "../../domain/ruleAst.js";

// Zod twin of `domain/ruleAst.ts`, which is itself the transcription of the
// grammar frozen in `02-system-design/07_validation_ast_schema.md:29-131`.
//
// Two copies of one grammar, and both are load-bearing: the TypeScript one is
// what the evaluator is compiled against, this one is what an untrusted request
// body is checked against. `satisfies z.ZodType<RuleAst>` at the bottom is what
// keeps them from drifting — if the domain type gains a node this schema does
// not accept, the file stops compiling rather than silently rejecting valid
// rules at runtime.
//
// `.strict()` everywhere on purpose. A rule is stored and re-evaluated later, so
// an unrecognised field silently dropped here would be a rule that means one
// thing to its author and another to the engine.

const entityTypeSchema = z.enum([
  "character",
  "event",
  "scene",
  "chapter",
  "faction",
  "world_element",
  "plot",
  "map",
  "layer",
]);

const bindingNameSchema = z.string().min(1);

const predicateReferenceSchema = z
  .object({
    type: z.literal("predicate_ref"),
    definition_id: z.uuid(),
  })
  .strict();

// Accepted by the grammar but never legal in an evaluated rule — only inside a
// template (safety rule 4). Parsed rather than rejected here so the refusal
// carries the reason, which the evaluator states as `unknown`.
const parameterReferenceSchema = z
  .object({
    type: z.literal("param_ref"),
    // `name`, matching `02-system-design/07_validation_ast_schema.md:677` and
    // its worked JSON at `:342`. An earlier draft called this `parameter`,
    // which renamed a wire key while the file header claimed wire names were
    // untouched — a template written against the document would have been
    // rejected by `.strict()` below.
    name: z.string().min(1),
  })
  .strict();

const comparisonOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "greater_than_or_eq",
  "less_than_or_eq",
  "contains",
  "not_contains",
]);

const orderAxisSchema = z.union([
  z
    .object({
      axis: z.literal("artifact"),
      field: z.enum(["chapter_order", "scene_order_in_chapter"]),
    })
    .strict(),
  z.object({ axis: z.literal("diegetic") }).strict(),
]);

const temporalOperandSchema = z
  .object({ type: z.literal("anchor"), binding: bindingNameSchema })
  .strict();

// `Expression` and `BooleanExpression` are mutually recursive through EntityQuery, so
// both go through z.lazy and the annotation has to be written out — TypeScript
// cannot infer a type that refers to itself.
const expressionSchema: z.ZodType<Expression> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal("constant"),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      })
      .strict(),
    z
      .object({
        type: z.literal("attr"),
        binding: bindingNameSchema,
        attribute: z.string().min(1),
      })
      .strict(),
    z
      .object({ type: z.literal("count"), of: entityQuerySchema })
      .strict(),
    z
      .object({
        type: z.literal("select_latest"),
        of: entityQuerySchema,
        order_by: orderAxisSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("select_first"),
        of: entityQuerySchema,
        order_by: orderAxisSchema,
      })
      .strict(),
  ]),
);

const entityQuerySchema: z.ZodType<EntityQuery> = z.lazy(() =>
  z
    .object({
      entity_type: entityTypeSchema,
      as: bindingNameSchema,
      where: booleanExpressionSchema.optional(),
    })
    .strict(),
);

const booleanExpressionSchema: z.ZodType<BooleanExpression> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal("and"),
        conditions: z.array(booleanExpressionSchema).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("or"),
        conditions: z.array(booleanExpressionSchema).min(1),
      })
      .strict(),
    z
      .object({ type: z.literal("not"), condition: booleanExpressionSchema })
      .strict(),
    z
      .object({
        type: z.literal("predicate"),
        left: expressionSchema,
        operator: comparisonOperatorSchema,
        right: expressionSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("relation_atom"),
        subject: bindingNameSchema,
        predicate_ref: z.union([predicateReferenceSchema, parameterReferenceSchema]),
        object: bindingNameSchema.optional(),
        at: z.object({ binding: bindingNameSchema }).strict().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("temporal_predicate"),
        left: temporalOperandSchema,
        operator: z.enum(["before", "after"]),
        right: temporalOperandSchema,
      })
      .strict(),
  ]),
);

const bindingSchema = z
  .object({
    name: bindingNameSchema,
    entity_type: entityTypeSchema,
    quantifier: z.enum(["exists", "forall"]),
    where: booleanExpressionSchema.optional(),
  })
  .strict();

export const ruleAstSchema = z
  .object({
    version: z.literal("1"),
    // Safety rule 7: binding names are unique across the whole rule. An alias
    // that shadows an outer binding makes an atom point at a different entity
    // than the author is reading, with no error anywhere — so uniqueness is
    // checked here, at the only boundary an untrusted rule crosses.
    bindings: z.array(bindingSchema).min(1),
    condition: booleanExpressionSchema,
    unless: booleanExpressionSchema.optional(),
    severity: z.enum(["error", "warning", "info"]),
    message_template: z.string().min(1),
  })
  .strict()
  .refine(
    (ast) => new Set(ast.bindings.map((b) => b.name)).size === ast.bindings.length,
    { message: "Binding names must be unique across the rule" },
  ) satisfies z.ZodType<RuleAst>;

export const evaluateRuleRequestSchema = z
  .object({ ast: ruleAstSchema })
  .strict();

export type EvaluateRuleRequestDto = z.infer<typeof evaluateRuleRequestSchema>;
