// The ONE error this fold's ports promise, and the reason it exists is the consumer:
// `GraphProjector` runs behind a RabbitMQ consumer that has to decide, per message,
// between "try again" and "dead-letter this". That decision cannot be made from a
// Prisma error code without teaching the consumer what Prisma is — which is the
// convention this codebase already follows everywhere else, where the adapter
// translates the vendor error and higher layers branch on a domain error
// (`ContentRelationshipRepositoryError.ts`).
//
// Only the TRANSIENT half is named. Everything else — a foreign key refusing a
// predicate the project never defined, a malformed query, any bug — surfaces raw and
// is non-retryable by default, so a second class would exist purely to be a synonym
// for "not this one". Precedent for letting those surface raw rather than dressing
// them up: the P2003 note at the end of `ContentRelationshipRepositoryError.ts`.
//
// `cause` is kept because the DLQ log line is the only place a human will read it.
export class EvaluationGraphTransientError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Evaluation graph ${operation} failed transiently`);
    this.name = "EvaluationGraphTransientError";
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
