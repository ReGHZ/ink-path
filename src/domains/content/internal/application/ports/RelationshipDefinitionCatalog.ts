import type {
  RelationshipDefinitionDetail,
  RelationshipDefinitionDraft,
} from "../../domain/support/relationshipDefinition.js";

// Separate port from `RelationshipDefinitionReader`, and the split is by AUDIENCE
// rather than by read/write: the reader serves the machinery (relationship
// validation, the projector, the rule evaluator) and hands back the matching
// shape only. This one serves the author's vocabulary screen, so it carries the
// display text — and keeping them apart is what stops display text from becoming
// something the engine can accidentally match on.
export type RelationshipDefinitionCatalog = {
  create(
    projectId: string,
    draft: RelationshipDefinitionDraft,
  ): Promise<RelationshipDefinitionDetail>;

  listDetails(
    projectId: string,
  ): Promise<readonly RelationshipDefinitionDetail[]>;
};
