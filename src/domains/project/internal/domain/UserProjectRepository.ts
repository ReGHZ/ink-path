import type { UserProject } from "./UserProject.js";

export type UserProjectRepository = {
  findActiveByProjectIdAndUserId(
    projectId: string,
    userId: string,
  ): Promise<UserProject | null>;

  findActiveByProjectIdAndUserIdForUpdate(
    projectId: string,
    userId: string,
  ): Promise<UserProject | null>;

  findActiveByProjectId(projectId: string): Promise<UserProject[]>;

  insert(userProject: UserProject): Promise<void>;

  // Optimistic concurrency (policy 06 §3): matches on `userProject.version`,
  // increments it on success. The passed-in entity is NOT refreshed with the
  // new version afterward (no RETURNING) — callers that reuse the same
  // instance for a second update() without reloading will send a stale
  // version and get a false conflict. Reload before updating twice.
  update(userProject: UserProject): Promise<void>;
};
