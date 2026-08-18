import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  CreateRelationshipInput,
  DeleteRelationshipInput,
  RelationshipDetail,
  UpdateRelationshipNoteInput,
} from "../../../application/support/RelationshipService.js";
import type { ContentEntityType } from "../../../domain/support/ContentRevision.js";
import type { CreateRelationshipRequestDto } from "../../dto/support/createRelationshipSchema.js";
import type { RelationshipDirection } from "../../dto/support/relationshipFieldSchemas.js";
import type {
  RelationshipListItemDto,
  RelationshipListResponseDto,
  RelationshipResponseDto,
} from "../../dto/support/relationshipResponseSchema.js";
import type { UpdateRelationshipRequestDto } from "../../dto/support/updateRelationshipSchema.js";

// The entity a nested list was requested for. Reading direction is a property of
// the QUESTION, not of the stored row — the same row is outgoing for one
// endpoint and incoming for the other — which is why the frozen addendum puts
// this computation in the DTO mapper and not in the domain
// (`02-system-design/03_flow_04_content_relationship.md:188`).
export type RelationshipPerspective = {
  entityType: ContentEntityType;
  entityId: string;
};

type PerspectiveView = {
  direction: RelationshipDirection;
  label: string;
};

// The two facts this needs — directionality and the inverse symbol — used to be
// pure lookups into a constant and are ROWS since step 4, so they arrive on the
// detail instead of being imported. The division the frozen addendum draws is
// unchanged and is the reason this still lives here: the registry supplies the
// symbol, the interface layer picks WHICH of the two applies to the perspective
// being read (§7.5). What moved is only where the symbol comes from.
function viewFromPerspective(
  detail: RelationshipDetail,
  perspective: RelationshipPerspective,
): PerspectiveView {
  const readFromSource =
    detail.sourceEntityType === perspective.entityType &&
    detail.sourceEntityId === perspective.entityId;

  // `readFromSource === false` means "read from the target": `findByEntity`
  // only returns rows where the perspective entity is one of the two endpoints
  // (`ContentRelationshipRepository.ts`), and rule 9 forbids a self-relationship,
  // so exactly one side matches.

  // A missing definition should be unreachable — the composite foreign key
  // `(project_id, relation_type)` refuses a row whose predicate the project does
  // not define. It is still handled, because the alternative to a verbatim label
  // is a 500 on GET, and the row stays perfectly meaningful without its label
  // flipped. Direction is structurally true either way; only the flip is
  // unknown, so no flip is applied.
  if (detail.directionality === undefined) {
    return {
      direction: readFromSource ? "outgoing" : "incoming",
      label: detail.relationType,
    };
  }

  if (detail.directionality === "non_directional") {
    return { direction: "non_directional", label: detail.relationType };
  }

  return readFromSource
    ? { direction: "outgoing", label: detail.relationType }
    : {
        direction: "incoming",
        label: detail.inverseLabel ?? detail.relationType,
      };
}

// Bridges DTO <-> the Input/Detail types RelationshipService already defines —
// never touches the ContentRelationship entity directly (mirrors LayerDtoMapper.ts).
export const RelationshipDtoMapper = {
  toCreateRelationshipInput(
    dto: CreateRelationshipRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreateRelationshipInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      sourceEntityType: dto.sourceEntityType,
      sourceEntityId: dto.sourceEntityId,
      targetEntityType: dto.targetEntityType,
      targetEntityId: dto.targetEntityId,
      relationType: dto.relationType,
      note: dto.note,
    };
  },

  toUpdateRelationshipNoteInput(
    dto: UpdateRelationshipRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateRelationshipNoteInput {
    return {
      requestingUserId,
      requestingMembership,
      note: dto.note,
    };
  },

  // No DTO parameter: DELETE has no body, and K6 forbids giving it one — the
  // version guard is read by the service from the row it just loaded, never
  // supplied by the caller.
  toDeleteRelationshipInput(
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): DeleteRelationshipInput {
    return { requestingUserId, requestingMembership };
  },

  toRelationshipResponse(detail: RelationshipDetail): RelationshipResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      sourceEntityType: detail.sourceEntityType,
      sourceEntityId: detail.sourceEntityId,
      targetEntityType: detail.targetEntityType,
      targetEntityId: detail.targetEntityId,
      relationType: detail.relationType,
      note: detail.note,
      createdByUserId: detail.createdByUserId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toRelationshipListItem(
    detail: RelationshipDetail,
    perspective: RelationshipPerspective,
  ): RelationshipListItemDto {
    return {
      ...RelationshipDtoMapper.toRelationshipResponse(detail),
      ...viewFromPerspective(detail, perspective),
    };
  },

  toRelationshipListResponse(
    details: RelationshipDetail[],
    perspective: RelationshipPerspective,
  ): RelationshipListResponseDto {
    return {
      relationships: details.map((detail) =>
        RelationshipDtoMapper.toRelationshipListItem(detail, perspective),
      ),
    };
  },
};
