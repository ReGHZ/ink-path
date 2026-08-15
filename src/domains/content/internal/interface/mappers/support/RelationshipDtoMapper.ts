import {
  inverseLabelOf,
  isDirectional,
  isRelationType,
} from "../../../domain/support/relationTypeRegistry.js";

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

// The registry is imported straight from `domain/` rather than being re-exported
// through the application layer: the allowed direction of dependency is
// `interface → application → domain` (`notes/02-struktur-domain-dan-test.md:81`),
// and this module is already the layer that maps entity-shaped data to DTOs.
// Threading two pure lookups through RelationshipService would only add a
// pass-through that the service itself never calls.
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

  // `relationType` is a plain `String` column with no enum and no CHECK
  // (`prisma/content-support.prisma:65`); the registry is the only thing
  // narrowing it, and registries shrink. A row written by an older build whose
  // type has since been retired must still be readable — rendering it verbatim
  // is a worse label, but a 500 on GET would be a worse API. Direction is still
  // structurally true; only the flip is unknown, so no flip is applied.
  if (!isRelationType(detail.relationType)) {
    return {
      direction: readFromSource ? "outgoing" : "incoming",
      label: detail.relationType,
    };
  }

  if (!isDirectional(detail.relationType)) {
    return { direction: "non_directional", label: detail.relationType };
  }

  return readFromSource
    ? { direction: "outgoing", label: detail.relationType }
    : { direction: "incoming", label: inverseLabelOf(detail.relationType) };
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
