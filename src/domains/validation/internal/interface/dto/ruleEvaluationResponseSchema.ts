import { z } from "zod";

// Three outcomes, and the third is not an error code. `unsupported` means the
// facts do not settle the question — the rule engine's designed baseline, and
// the point at which the AI path takes over
// (`02-system-design/06_validation_domain.md`). A caller that treated it as a
// failure would have the product backwards.
//
// `.strict()`: this response is the contract the rest of Phase 11 will read, so
// a field leaking in unnoticed is a contract nobody agreed to.
export const ruleEvaluationResponseSchema = z
  .object({
    outcome: z.enum(["conflict", "valid", "unsupported"]),
  })
  .strict();

export type RuleEvaluationResponseDto = z.infer<
  typeof ruleEvaluationResponseSchema
>;
