import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type { CreateRelationshipDefinitionInput } from "../../../application/support/RelationshipDefinitionService.js";
import type { RelationshipDefinitionDetail } from "../../../domain/support/relationshipDefinition.js";
import type { CreateRelationshipDefinitionRequestDto } from "../../dto/support/createRelationshipDefinitionSchema.js";
import type {
  RelationshipDefinitionListResponseDto,
  RelationshipDefinitionResponseDto,
} from "../../dto/support/relationshipDefinitionResponseSchema.js";

// The `label`/`inverseLabel` a client sees are TEXT, while `predicate` is the
// symbol. The renaming stops here so an API field name never repeats a column
// name (`display_label`): the column can change without touching the contract,
// and the contract can change without a migration.
export const RelationshipDefinitionDtoMapper = {
  toCreateRelationshipDefinitionInput(
    dto: CreateRelationshipDefinitionRequestDto,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreateRelationshipDefinitionInput {
    return {
      projectId,
      requestingMembership,
      label: dto.label,
      inverseLabel: dto.inverseLabel ?? null,
      objectRequired: dto.objectRequired,
      directionality: dto.directionality ?? null,
      signatures: dto.signatures,
    };
  },

  toRelationshipDefinitionResponse(
    detail: RelationshipDefinitionDetail,
  ): RelationshipDefinitionResponseDto {
    return {
      id: detail.id,
      predicate: detail.predicate,
      label: detail.displayLabel,
      inverseLabel: detail.inverseDisplayLabel,
      objectRequired: detail.objectRequired,
      directionality: detail.directionality,
      signatures: detail.signatures.map((signature) => ({
        subjectEntityType: signature.subjectEntityType,
        objectEntityType: signature.objectEntityType,
      })),
    };
  },

  toRelationshipDefinitionListResponse(
    details: readonly RelationshipDefinitionDetail[],
  ): RelationshipDefinitionListResponseDto {
    return {
      definitions: details.map((detail) =>
        RelationshipDefinitionDtoMapper.toRelationshipDefinitionResponse(detail),
      ),
    };
  },
};
