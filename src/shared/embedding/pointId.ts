import { v5 as uuidv5 } from "uuid";

// Fixed forever — this namespace is mixed into every point_id derivation, so
// changing it would silently orphan every previously-upserted Qdrant point
// (same canonical key, different point_id). Value itself is arbitrary, just
// needs to stay constant.
const POINT_ID_NAMESPACE = "96413c6f-5ffd-4a2f-a1b8-ae27f4bb5433";

export type PointKeyParts = {
  projectId: string;
  entityType: string;
  entityId: string;
  contentField: string;
  revisionId: string;
  chunkIndex: number;
};

// 05-implementation-policy/03_qdrant_point_id_chunking.md:§3 — canonical key format.
export function buildPointKey(parts: PointKeyParts): string {
  return [
    parts.projectId,
    parts.entityType,
    parts.entityId,
    parts.contentField,
    parts.revisionId,
    parts.chunkIndex,
  ].join(":");
}

// Qdrant point IDs must be an unsigned 64-bit integer or a UUID — an arbitrary
// hash string (e.g. a SHA-256 hex digest) is rejected outright. UUID v5 is the
// standard tool for "deterministic UUID from an arbitrary string": same input,
// same output, every time, and it's a format Qdrant actually accepts.
export function derivePointId(pointKey: string): string {
  return uuidv5(pointKey, POINT_ID_NAMESPACE);
}
