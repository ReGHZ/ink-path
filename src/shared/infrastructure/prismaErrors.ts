export function isUniqueViolation(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
    );
}

export function isNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2025"
    );
}

// P2003 = foreign key constraint violation. Fires when an operation breaks a
// referential-integrity constraint guarded by `onDelete: Restrict`. Note this
// code is overloaded: on `delete()` it means the target is still referenced
// (referent in use); on `insert()`/`update()` of a child it means the parent
// the child points at does not exist (referent missing). The helper only
// detects the Prisma code generically; the repository method decides which
// domain error fits the operation.
export function isForeignKeyViolation(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2003"
    );
}

// Returns the offending Postgres FK constraint name for a P2003, or null when
// the shape cannot be read.
//
// The shape below was VERIFIED empirically against Postgres 17 via the
// `@prisma/adapter-pg` driver adapter in Prisma 7.8.0 (probe runs
// 2026-07-15 inside the ink-path devcontainer; temp scripts since removed).
// A P2003 surfaces as:
//
//   meta.driverAdapterError.cause = {
//     kind: "ForeignKeyConstraintViolation",
//     originalCode: "23503",
//     originalMessage: "...violates foreign key constraint \"<name>\"",
//     constraint: { index: "<name>" }
//   }
//
// Verified constraint names for `layers`:
//   parent        -> "layers_parent_id_fkey"
//   project       -> "layers_project_id_fkey"
//   createdByUser -> "layers_created_by_user_id_fkey"
// (mirror for `maps` with the `maps_` prefix.)
//
// IMPORTANT: this shape is NOT the flat `meta.field_name` documented for older
// Prisma / non-driver-adapter paths. Hardcoding `meta.field_name` would never
// match here — every P2003 would fall through to the raw branch, making
// `*ParentNotFoundError` silently never fire. That is exactly why the real
// shape had to be probed before writing the check.
//
// The navigation is deliberately duck-typed and defensive: if any level is
// absent (adapter swapped, Prisma version changes, non-PG driver), it returns
// null so the caller's safe-default is to bubble the error raw rather than
// mistranslate it. The caller owns the per-table constant it compares against,
// so this helper stays free of schema coupling.
export function extractForeignKeyConstraint(error: unknown): string | null {
    const constraint = extractConstraint(error);
    if (constraint === null) {
        return null;
    }

    const index = (constraint as { index?: unknown }).index;
    return typeof index === "string" ? index : null;
}

// Shared navigation for both P2003 and P2002: meta.driverAdapterError.cause
// .constraint. Kept private — callers get a typed accessor per violation kind
// because the two do NOT carry the same payload (see below).
function extractConstraint(error: unknown): object | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }

    const meta = (error as { meta?: unknown }).meta;
    if (typeof meta !== "object" || meta === null) {
        return null;
    }

    const driverAdapterError = (
        meta as { driverAdapterError?: unknown }
    ).driverAdapterError;
    if (
        typeof driverAdapterError !== "object" ||
        driverAdapterError === null
    ) {
        return null;
    }

    const cause = (driverAdapterError as { cause?: unknown }).cause;
    if (typeof cause !== "object" || cause === null) {
        return null;
    }

    const constraint = (cause as { constraint?: unknown }).constraint;
    return typeof constraint === "object" && constraint !== null
        ? constraint
        : null;
}

// Returns the COLUMN names of the unique index a P2002 fired on, or null when
// the shape cannot be read.
//
// VERIFIED empirically against Postgres 17 / Prisma 7.8.0 via
// `@prisma/adapter-pg` (probe 2026-08-12 inside the ink-path devcontainer,
// temp script removed afterwards). A P2002 surfaces as:
//
//   meta.driverAdapterError.cause = {
//     kind: "UniqueConstraintViolation",
//     originalCode: "23505",
//     originalMessage: "...violates unique constraint \"chapters_project_id_order_key\"",
//     constraint: { fields: ["project_id", "\"order\""] }
//   }
//
// Two differences from the P2003 shape that matter and are easy to get wrong:
// (1) it carries `fields`, NOT `index` — reusing extractForeignKeyConstraint()
// here would always return null, so every unique violation would silently fall
// through to the generic Conflict branch; (2) the entries are raw DATABASE
// column names (`project_id`, not `projectId`) and reserved words arrive
// quoted (`"order"`), so they are unquoted here before being handed back.
// Matching on columns rather than parsing the constraint name out of
// `originalMessage` keeps this free of message-format coupling.
export function extractUniqueConstraintColumns(
    error: unknown,
): string[] | null {
    const constraint = extractConstraint(error);
    if (constraint === null) {
        return null;
    }

    const fields = (constraint as { fields?: unknown }).fields;
    if (!Array.isArray(fields)) {
        return null;
    }

    const columns: string[] = [];

    for (const field of fields) {
        if (typeof field !== "string") {
            return null;
        }

        columns.push(field.replaceAll(/^"|"$/g, ""));
    }

    return columns;
}

// True when a P2002 fired on exactly the given composite unique index. Order
// insensitive on purpose: the column order Postgres reports is an index
// detail, not something a caller should have to mirror. Callers own the
// column tuple (the schema coupling stays next to the repository that knows
// the table); a null/mismatched shape answers false so the safe default is
// the caller's generic conflict branch.
export function matchesUniqueConstraint(
    error: unknown,
    columns: readonly string[],
): boolean {
    const actual = extractUniqueConstraintColumns(error);

    if (actual?.length !== columns.length) {
        return false;
    }

    const expected = new Set(columns);

    return actual.every((column) => expected.has(column));
}

// DATABASE-level transients: the same statement, run again, can succeed. Added for the
// graph projector (step 4b-4, stage C), which must tell "retry this message" apart from
// "this message will never work" — but the knowledge is Prisma's, not any one domain's,
// which is why it sits here beside the other code-reading helpers.
//
// WHAT IS DELIBERATELY NOT HERE, and each omission is a policy that belongs to a
// caller rather than to the database:
//
//   · P2002 (unique violation). `isUniqueViolation` above already owns that code, and
//     whether a duplicate is transient depends entirely on WHOSE unique key it is: for
//     the CRUD surface it is a deterministic, user-facing duplicate
//     (`ContentRelationshipRepositoryDuplicateError`); for a fold whose only unique
//     keys are identity keys it would have converged on anyway, it means a concurrent
//     writer got there first. A caller wanting the second reading composes the two
//     helpers, as `PrismaEvaluationGraphRepository` does.
//   · P2003 (foreign key). For a fold it means the log or the vocabulary disagrees with
//     what is being folded, and no number of attempts changes that.
//   · `PrismaClientValidationError` — a malformed query, i.e. a code bug.
//
// Not shared with `isRetryableEmbeddingWorkerError` either, and that is a difference in
// POLICY rather than duplication left lying around: that classifier answers `false` for
// every `PrismaClientKnownRequestError` on purpose (see its closing comment — failing
// fast beat holding a prefetch slot through a full backoff during an outage). Bringing
// it onto this helper would change that decision for a slice this step does not own.
// SQLSTATEs that mean "the statement never had a fair chance", read from the
// DRIVER error rather than from a Prisma code — and that indirection is the whole
// point of this set existing beside the one below.
//
// MEASURED, not assumed (`test/integration/deadlock-classification.integration.test.ts`,
// step 4b-5 langkah 7): with the pg driver adapter a real deadlock does NOT arrive
// as `P2034`. It arrives as `DriverAdapterError` with NO `code` of its own and the
// SQLSTATE buried in `cause` — so the version of this file that matched Prisma
// codes only answered `false` for every genuine deadlock. That was not a
// theoretical gap: the fold and reader paths decide retry-vs-dead-letter from this
// function, so a projector message that deadlocked was dead-lettered instead of
// retried.
//
// Deliberately NOT "every DriverAdapterError is transient": a CHECK constraint
// violation arrives in exactly the same wrapper, and retrying that forever is the
// opposite of the right answer. The SQLSTATE is what separates them.
const TRANSIENT_POSTGRES_SQLSTATES = new Set([
    // 40001 serialization_failure — SERIALIZABLE/REPEATABLE READ conflict.
    "40001",
    // 40P01 deadlock_detected — two writers took the same locks in opposite
    // order and Postgres killed this one. Nothing was committed, so repeating the
    // whole transaction is the documented answer.
    "40P01",
]);

const TRANSIENT_PRISMA_CODES = new Set([
    // Cannot reach the database server / connection timed out / server closed it.
    "P1001",
    "P1002",
    "P1017",
    // Transaction failed to commit: Prisma's OWN mapping of a serialization
    // failure or deadlock. Kept, but it is not the route a deadlock actually
    // takes under the pg driver adapter — that one is
    // `TRANSIENT_POSTGRES_SQLSTATES` above, measured rather than assumed.
    "P2034",
    // Timed out waiting for a connection from the pool. NOT a data problem at all — the
    // statement never reached Postgres — and the queue-driven callers are exactly the ones
    // that can cause it: a consumer with prefetch N runs up to N handlers at once against a
    // pool that is smaller than N unless someone did the arithmetic. Dead-lettering a fact
    // because the pool was briefly busy would be the wrong answer to the right signal.
    "P2024",
]);

export function isTransientDatabaseError(error: unknown): boolean {
    // Read by SHAPE, like every other helper in this file — no `instanceof
    // Prisma.*`. This module has no Prisma import on purpose, and the two error
    // classes without a `code` are matched by `name` for the same reason.
    if (typeof error !== "object" || error === null) {
        return false;
    }

    const name = (error as { name?: unknown }).name;

    // The client could not connect at all (the statement never ran), and Prisma's
    // escape hatch for errors it could not map — in practice a connection reset
    // mid-query, or a Postgres error with no assigned code.
    if (
        name === "PrismaClientInitializationError" ||
        name === "PrismaClientUnknownRequestError"
    ) {
        return true;
    }

    // The driver's own wrapper, which carries no `code` at the top level. Read by
    // NAME for the same reason as the two classes above: this module imports
    // nothing from Prisma on purpose.
    if (name === "DriverAdapterError") {
        const cause = (error as { cause?: unknown }).cause;

        if (typeof cause !== "object" || cause === null) {
            return false;
        }

        const sqlState = (cause as { code?: unknown }).code;

        return (
            typeof sqlState === "string" &&
            TRANSIENT_POSTGRES_SQLSTATES.has(sqlState)
        );
    }

    const code = (error as { code?: unknown }).code;

    return typeof code === "string" && TRANSIENT_PRISMA_CODES.has(code);
}
