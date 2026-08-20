import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { handleError } from "./errorHandler.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { AppEnvironment } from "./context.js";

// Step 4b-5 langkah 7. The boundary answer for database contention, which every
// route shares because `app.onError(handleError)` is registered once
// (`src/app.ts:56`).
//
// The transient error below is HAND-BUILT, and on its own that would be worth
// very little: it would prove this file agrees with itself. What makes it
// evidence is the pair —
// `test/integration/deadlock-classification.integration.test.ts` forces a REAL
// deadlock and asserts the shape used here is the shape Postgres and the driver
// actually produce. Change one without the other and that file fails.
function buildApp(thrown: unknown) {
  const app = new Hono<AppEnvironment>();

  app.onError(handleError);
  app.get("/boom", () => {
    throw thrown;
  });

  return app;
}

// The measured shape: no `code` of its own, SQLSTATE inside `cause`.
function deadlockError(): unknown {
  return Object.assign(new Error("deadlock detected"), {
    name: "DriverAdapterError",
    cause: {
      kind: "postgres",
      code: "40P01",
      severity: "ERROR",
      message: "deadlock detected",
    },
  });
}

describe("handleError", () => {
  it("answers 503 with a retry hint when the database refused the attempt", async () => {
    const response = await buildApp(deadlockError()).request("/boom");

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");

    const body = (await response.json()) as { error: { code: string } };

    // The status class says "server-side, try later"; the CODE is what a client
    // branches on, and what separates contention from an unknown bug in a log.
    expect(body.error.code).toBe(ErrorCode.UNAVAILABLE);
  });

  // The discriminating pair: a permanent failure arrives in the SAME wrapper
  // class, so answering on the wrapper rather than on the SQLSTATE would turn
  // "this row will never be accepted" into "keep retrying forever".
  it("still answers 500 for a driver error that is not contention", async () => {
    const permanent = Object.assign(
      new Error("violates check constraint"),
      {
        name: "DriverAdapterError",
        cause: {
          kind: "postgres",
          code: "23514",
          severity: "ERROR",
          message: "violates check constraint",
        },
      },
    );

    const response = await buildApp(permanent).request("/boom");

    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBeNull();

    const body = (await response.json()) as { error: { code: string } };

    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it("leaves an AppError's own code and status alone", async () => {
    const response = await buildApp(
      new AppError(ErrorCode.CONFLICT, "Applied effect cannot be deleted"),
    ).request("/boom");

    expect(response.status).toBe(409);

    const body = (await response.json()) as { error: { code: string } };

    expect(body.error.code).toBe(ErrorCode.CONFLICT);
  });

  it("answers 500 for an error with no database shape at all", async () => {
    const response = await buildApp(new Error("something else")).request(
      "/boom",
    );

    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: { code: string } };

    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
