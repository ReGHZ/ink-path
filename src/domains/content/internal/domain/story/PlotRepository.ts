import type { Plot } from "./Plot.js";

export type PlotRepository = {
  findById(id: string): Promise<Plot | null>;

  findByProjectId(projectId: string): Promise<Plot[]>;

  insert(plot: Plot): Promise<void>;

  // Optimistic concurrency (policy 06 §3): matches on `plot.version`,
  // increments it on success, does NOT refresh the passed-in instance.
  update(plot: Plot): Promise<void>;

  // Guarded delete — version covers every write to the row, delete included.
  delete(id: string, expectedVersion: number): Promise<void>;

  // Create-flow only (policy 06 §4, currentRevisionId circular dependency).
  linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void>;
};
