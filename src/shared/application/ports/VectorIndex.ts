import type { QdrantPointPayload } from "../../embedding/qdrantPayload.js";

export type VectorIndexPoint = {
  id: string;
  vector: number[];
  payload: QdrantPointPayload;
};

export type VectorIndex = {
  // Idempotent — creates the collection + payload indexes if they don't already
  // exist. Safe to call on every worker startup.
  ensureCollection(): Promise<void>;
  upsertPoints(points: VectorIndexPoint[]): Promise<void>;
  deletePointsForEntity(parameters: {
    projectId: string;
    entityType: string;
    entityId: string;
  }): Promise<void>;
};
