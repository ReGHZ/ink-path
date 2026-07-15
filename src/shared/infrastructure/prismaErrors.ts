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
    if (typeof constraint !== "object" || constraint === null) {
        return null;
    }

    const index = (constraint as { index?: unknown }).index;
    return typeof index === "string" ? index : null;
}