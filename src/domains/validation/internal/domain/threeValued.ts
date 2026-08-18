// Strong Kleene three-valued logic (`02-system-design/07_validation_ast_schema.md:127-129`).
//
// The third value is not a convenience. This engine answers questions about a
// world an author is still writing, so "the facts do not settle it" is a real
// answer and it must never be rounded to `false` — that rounding is what turns
// a silence into a reported contradiction, which the design calls the most
// damaging failure this product can have.
//
// `not unknown = unknown` is the clause most often written wrong, and it is the
// one that keeps ignorance from becoming evidence when a rule negates.

export type Truth = "true" | "false" | "unknown";

export function fromBoolean(value: boolean): Truth {
  return value ? "true" : "false";
}

// `and` is false as soon as ANY operand is false, even beside an unknown: a
// conjunction with a definitely-false member cannot hold no matter how the
// unknown resolves. Only when nothing is false and something is unknown does
// the whole become unknown.
export function and(values: readonly Truth[]): Truth {
  if (values.includes("false")) {
    return "false";
  }

  return values.includes("unknown") ? "unknown" : "true";
}

// Mirror image: true wins over unknown, because one definitely-true member
// settles a disjunction whatever the rest do.
export function or(values: readonly Truth[]): Truth {
  if (values.includes("true")) {
    return "true";
  }

  return values.includes("unknown") ? "unknown" : "false";
}

export function not(value: Truth): Truth {
  switch (value) {
    case "true":
      return "false";
    case "false":
      return "true";
    case "unknown":
      return "unknown";
  }
}
