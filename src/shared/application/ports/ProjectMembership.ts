export type ProjectRole = "writer" | "editor" | "reviewer";

// Transport-agnostic shape of "what this caller is allowed to do on this
// project" — deliberately NOT the same type as shared/http/context.ts's
// ProjectMemberInfo (which also carries aiAccess/userId, HTTP-context
// concerns). Application Services must not depend on shared/http/* — that
// would be an Application layer knowing about the transport layer. Callers
// (Controllers today; anything else later) build this from whatever their
// own membership lookup already resolved.
export type ProjectMembership = {
  role: ProjectRole;
  canDelete: boolean;
};
