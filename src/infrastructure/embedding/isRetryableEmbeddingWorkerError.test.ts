import {
  QdrantClientResourceExhaustedError,
  QdrantClientTimeoutError,
} from "@qdrant/js-client-rest";
import { ApiError } from "@qdrant/openapi-typescript-fetch";
import { describe, expect, it } from "vitest";

import { isRetryableEmbeddingWorkerError } from "./isRetryableEmbeddingWorkerError.js";
import { Prisma } from "../../generated/prisma/client.js";

function apiError(status: number, statusText: string): ApiError {
  return new ApiError({
    headers: new Headers(),
    url: "http://qdrant:6333/collections/content_embeddings/points/scroll",
    status,
    statusText,
    data: null,
  });
}

describe("isRetryableEmbeddingWorkerError", () => {
  it("treats QdrantClientResourceExhaustedError (429 with retry-after) as retryable", () => {
    const error = new QdrantClientResourceExhaustedError(
      "Too Many Requests",
      "5",
    );

    expect(isRetryableEmbeddingWorkerError(error)).toBe(true);
  });

  it("treats a raw Qdrant ApiError with a 5xx status as retryable", () => {
    expect(isRetryableEmbeddingWorkerError(apiError(500, "Internal Server Error"))).toBe(
      true,
    );
    expect(isRetryableEmbeddingWorkerError(apiError(503, "Service Unavailable"))).toBe(
      true,
    );
  });

  it("treats a raw Qdrant ApiError with status 429 (no retry-after header) as retryable", () => {
    expect(isRetryableEmbeddingWorkerError(apiError(429, "Too Many Requests"))).toBe(
      true,
    );
  });

  it("treats a raw Qdrant ApiError with a non-429 4xx status as NOT retryable", () => {
    expect(isRetryableEmbeddingWorkerError(apiError(400, "Bad Request"))).toBe(false);
    expect(isRetryableEmbeddingWorkerError(apiError(404, "Not Found"))).toBe(false);
  });

  it("treats QdrantClientTimeoutError as retryable", () => {
    const error = new QdrantClientTimeoutError("The user aborted a request.");

    expect(isRetryableEmbeddingWorkerError(error)).toBe(true);
  });

  it("treats a network-level fetch failure (Qdrant/provider unreachable) as retryable", () => {
    const error = new TypeError("fetch failed");

    expect(isRetryableEmbeddingWorkerError(error)).toBe(true);
  });

  it("does not mistake an unrelated TypeError for a network-level fetch failure", () => {
    const error = new TypeError("Cannot read properties of undefined");

    expect(isRetryableEmbeddingWorkerError(error)).toBe(false);
  });

  it("treats PrismaClientInitializationError (DB connection/startup failure) as retryable", () => {
    const error = new Prisma.PrismaClientInitializationError(
      "Can't reach database server",
      "7.8.0",
    );

    expect(isRetryableEmbeddingWorkerError(error)).toBe(true);
  });

  it("treats PrismaClientKnownRequestError (constraint violation, not-found, etc.) as NOT retryable", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields",
      { code: "P2002", clientVersion: "7.8.0" },
    );

    expect(isRetryableEmbeddingWorkerError(error)).toBe(false);
  });

  it("treats PrismaClientValidationError (malformed query) as NOT retryable", () => {
    const error = new Prisma.PrismaClientValidationError("Invalid query", {
      clientVersion: "7.8.0",
    });

    expect(isRetryableEmbeddingWorkerError(error)).toBe(false);
  });

  it("defaults to NOT retryable for any unrecognized error (embedding provider errors with no structured shape, plain bugs, etc.)", () => {
    expect(isRetryableEmbeddingWorkerError(new Error("something unexpected"))).toBe(
      false,
    );
    expect(isRetryableEmbeddingWorkerError("a thrown string, not an Error")).toBe(
      false,
    );
    expect(isRetryableEmbeddingWorkerError(undefined)).toBe(false);
  });
});
