import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  AddEffectInput,
  DeclareTransitionInput,
  MutateTransitionInput,
  NarrativeTransitionDetail,
  TransitionEffectDetail,
  UpdateTransitionDetailsInput,
} from "../../../application/transition/NarrativeTransitionService.js";
import type { AddEffectRequestDto } from "../../dto/transition/addEffectSchema.js";
import type { DeclareTransitionRequestDto } from "../../dto/transition/declareTransitionSchema.js";
import type {
  NarrativeTransitionListResponseDto,
  NarrativeTransitionResponseDto,
  TransitionEffectResponseDto,
} from "../../dto/transition/transitionResponseSchema.js";
import type { UpdateTransitionRequestDto } from "../../dto/transition/updateTransitionSchema.js";

// Bridges DTO <-> the Input/Detail types NarrativeTransitionService already
// defines, and touches neither aggregate directly (mirrors
// `../support/RelationshipDtoMapper.ts`). Nothing here computes anything: unlike
// the relationship mapper, which owns the perspective-dependent
// `direction`/`label`, a transition reads identically from every angle, so a
// mapper that did arithmetic would be inventing a fact the domain did not state.
export const NarrativeTransitionDtoMapper = {
  toDeclareTransitionInput(
    dto: DeclareTransitionRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): DeclareTransitionInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      sourceEntityType: dto.sourceEntityType,
      sourceEntityId: dto.sourceEntityId,
      title: dto.title,
      description: dto.description,
      reversesTransitionId: dto.reversesTransitionId,
    };
  },

  // `dto.title` and `dto.description` are passed through VERBATIM — no `?? null`
  // anywhere. `undefined` and `null` mean different things on this path
  // (`updateTransitionSchema.ts`): the service acts only on keys that are not
  // undefined (`NarrativeTransition.ts:181-196`), so coalescing here would turn
  // "leave the description alone" into "clear the description" for every request
  // that omits it — a data-losing bug that no type would catch, because
  // `string | null | undefined` accepts the wrong answer as happily as the right
  // one.
  toUpdateTransitionDetailsInput(
    dto: UpdateTransitionRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateTransitionDetailsInput {
    return {
      requestingUserId,
      requestingMembership,
      title: dto.title,
      description: dto.description,
    };
  },

  // Switches on the discriminant instead of spreading `...dto`, and the
  // difference is not stylistic: a spread would compile, and it would also carry
  // any future field of one variant into the other the moment the DTO grows,
  // because `AddEffectInput` accepts each branch as a whole. Naming the fields
  // per branch means the compiler re-checks the mapping every time either union
  // changes.
  toAddEffectInput(
    dto: AddEffectRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): AddEffectInput {
    if (dto.effectType === "attribute_change") {
      return {
        requestingUserId,
        requestingMembership,
        effectType: dto.effectType,
        targetEntityType: dto.targetEntityType,
        targetEntityId: dto.targetEntityId,
        fieldPath: dto.fieldPath,
        newValue: dto.newValue,
      };
    }

    return {
      requestingUserId,
      requestingMembership,
      effectType: dto.effectType,
      targetEntityType: dto.targetEntityType,
      targetEntityId: dto.targetEntityId,
      relationshipType: dto.relationshipType,
      relatedEntityType: dto.relatedEntityType,
      relatedEntityId: dto.relatedEntityId,
    };
  },

  // No DTO parameter, for the same reason `toDeleteRelationshipInput` has none:
  // delete and apply carry no body. Apply in particular takes NOTHING from the
  // caller — what it will do was fixed when the effect was declared, and letting
  // a request adjust it at apply time would make the stored intent a suggestion
  // (`TransitionEffect.ts:33-39`: `new_value` is the intent, not a claim).
  toMutateTransitionInput(
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): MutateTransitionInput {
    return { requestingUserId, requestingMembership };
  },

  toTransitionEffectResponse(
    detail: TransitionEffectDetail,
  ): TransitionEffectResponseDto {
    return {
      id: detail.id,
      narrativeTransitionId: detail.narrativeTransitionId,
      projectId: detail.projectId,
      effectType: detail.effectType,
      targetEntityType: detail.targetEntityType,
      targetEntityId: detail.targetEntityId,
      fieldPath: detail.fieldPath,
      newValue: detail.newValue,
      relationshipType: detail.relationshipType,
      relatedEntityType: detail.relatedEntityType,
      relatedEntityId: detail.relatedEntityId,
      appliedAt: detail.appliedAt,
      contentRevisionId: detail.contentRevisionId,
      createdAt: detail.createdAt,
    };
  },

  toNarrativeTransitionResponse(
    detail: NarrativeTransitionDetail,
  ): NarrativeTransitionResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      sourceEntityType: detail.sourceEntityType,
      sourceEntityId: detail.sourceEntityId,
      title: detail.title,
      description: detail.description,
      declaredByUserId: detail.declaredByUserId,
      reversesTransitionId: detail.reversesTransitionId,
      status: detail.status,
      effects: detail.effects.map((effect) =>
        NarrativeTransitionDtoMapper.toTransitionEffectResponse(effect),
      ),
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toNarrativeTransitionListResponse(
    details: NarrativeTransitionDetail[],
  ): NarrativeTransitionListResponseDto {
    return {
      narrativeTransitions: details.map((detail) =>
        NarrativeTransitionDtoMapper.toNarrativeTransitionResponse(detail),
      ),
    };
  },
};
