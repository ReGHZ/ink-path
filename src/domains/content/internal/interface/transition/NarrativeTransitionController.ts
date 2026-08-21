import { NESTED_TRANSITION_ROUTES } from "./nestedTransitionRoutes.js";
import {
  NARRATIVE_TRANSITION_ID_PARAMETER,
  ASSERTION_ID_PARAMETER,
} from "./transitionRouteParameters.js";
import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { addEffectSchema } from "../dto/transition/addEffectSchema.js";
import { declareTransitionSchema } from "../dto/transition/declareTransitionSchema.js";
import {
  narrativeTransitionListResponseSchema,
  narrativeTransitionResponseSchema,
  assertionResponseSchema,
} from "../dto/transition/transitionResponseSchema.js";
import { updateTransitionSchema } from "../dto/transition/updateTransitionSchema.js";
import { NarrativeTransitionDtoMapper } from "../mappers/transition/NarrativeTransitionDtoMapper.js";

import type { NarrativeTransitionService } from "../../application/transition/NarrativeTransitionService.js";
import type { NarrativeTransitionSourceType } from "../../domain/transition/NarrativeTransition.js";
import type { Context } from "hono";

// The two path-parameter messages, written once. They repeat the sentences the
// SERVICE already answers with (`NarrativeTransitionService.ts:141,518`): a
// missing id in the path and a well-formed id that resolves to nothing must be
// indistinguishable from outside, otherwise the shape of the 404 tells a caller
// whether a row exists.
const NARRATIVE_TRANSITION_NOT_FOUND = "Narrative transition not found";
const TRANSITION_EFFECT_NOT_FOUND = "Transition assertion not found";

// No try/catch anywhere in this file, and that is a decision rather than an
// omission. `NarrativeTransitionService` already translates every failure class
// it can produce into an `AppError` with the right status — 404 for a missing
// transition, 409 for the three drift cases and for a concurrently modified
// target, 400 for every DomainError (`NarrativeTransitionService.ts:139-191`) —
// and `handleError` renders those. Re-mapping here would give one condition two
// answers depending on which layer noticed it first, which is exactly the defect
// the 7.7 gate rejected (`ContentRelationshipRepositoryNotFoundError` answered
// 404 on one path and 409 on the other).
export class NarrativeTransitionController {
  constructor(
    private readonly narrativeTransitionService: NarrativeTransitionService,
  ) {}

  async declareTransition(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, declareTransitionSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const member = requireProjectMember(c);

    const input = NarrativeTransitionDtoMapper.toDeclareTransitionInput(
      dto,
      userId,
      projectId,
      { role: member.role, canDelete: member.canDelete },
    );

    const detail =
      await this.narrativeTransitionService.declareTransition(input);
    const response =
      NarrativeTransitionDtoMapper.toNarrativeTransitionResponse(detail);

    return success(c, narrativeTransitionResponseSchema.parse(response), 201);
  }

  async listTransitions(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details =
      await this.narrativeTransitionService.listTransitionsByProject(projectId);
    const response =
      NarrativeTransitionDtoMapper.toNarrativeTransitionListResponse(details);

    return success(c, narrativeTransitionListResponseSchema.parse(response));
  }

  // One method for all three nested routes. `sourceEntityType` is a parameter of
  // the METHOD, supplied by the route table as a compile-time constant, so a
  // typo is a build failure and there is no per-type controller code to keep in
  // sync — the same construction `RelationshipController` uses for its nine.
  async listTransitionsBySourceEntity(
    c: Context<AppEnvironment>,
    sourceEntityType: NarrativeTransitionSourceType,
  ) {
    const route = NESTED_TRANSITION_ROUTES[sourceEntityType];
    const projectId = requireProjectId(c);
    const sourceEntityId = requireRouteParameter(
      c,
      route.parameterName,
      route.notFoundMessage,
    );

    const details =
      await this.narrativeTransitionService.listTransitionsBySourceEntity(
        projectId,
        sourceEntityType,
        sourceEntityId,
      );
    const response =
      NarrativeTransitionDtoMapper.toNarrativeTransitionListResponse(details);

    return success(c, narrativeTransitionListResponseSchema.parse(response));
  }

  async getTransition(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const transitionId = requireRouteParameter(
      c,
      NARRATIVE_TRANSITION_ID_PARAMETER,
      NARRATIVE_TRANSITION_NOT_FOUND,
    );

    const detail = await this.narrativeTransitionService.getTransitionById(
      projectId,
      transitionId,
    );
    const response =
      NarrativeTransitionDtoMapper.toNarrativeTransitionResponse(detail);

    return success(c, narrativeTransitionResponseSchema.parse(response));
  }

  async updateTransitionDetails(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateTransitionSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const transitionId = requireRouteParameter(
      c,
      NARRATIVE_TRANSITION_ID_PARAMETER,
      NARRATIVE_TRANSITION_NOT_FOUND,
    );
    const member = requireProjectMember(c);

    const input = NarrativeTransitionDtoMapper.toUpdateTransitionDetailsInput(
      dto,
      userId,
      { role: member.role, canDelete: member.canDelete },
    );

    const detail =
      await this.narrativeTransitionService.updateTransitionDetails(
        projectId,
        transitionId,
        input,
      );
    const response =
      NarrativeTransitionDtoMapper.toNarrativeTransitionResponse(detail);

    return success(c, narrativeTransitionResponseSchema.parse(response));
  }

  // `can_delete` is never consulted on this path, deliberately, exactly as on
  // the relationship delete: the service's one guard is `assertCanWrite`
  // (`NarrativeTransitionService.ts:130-137`), because deleting a transition
  // destroys an intention, not content — and one whose assertions are all still
  // pending, since a single applied assertion makes the delete a 409 (D7).
  async deleteTransition(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const transitionId = requireRouteParameter(
      c,
      NARRATIVE_TRANSITION_ID_PARAMETER,
      NARRATIVE_TRANSITION_NOT_FOUND,
    );
    const member = requireProjectMember(c);

    await this.narrativeTransitionService.deleteTransition(
      projectId,
      transitionId,
      NarrativeTransitionDtoMapper.toMutateTransitionInput(userId, {
        role: member.role,
        canDelete: member.canDelete,
      }),
    );

    return success(c, null, 200);
  }

  async addAssertion(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, addEffectSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const transitionId = requireRouteParameter(
      c,
      NARRATIVE_TRANSITION_ID_PARAMETER,
      NARRATIVE_TRANSITION_NOT_FOUND,
    );
    const member = requireProjectMember(c);

    const input = NarrativeTransitionDtoMapper.toAddEffectInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.narrativeTransitionService.addAssertion(
      projectId,
      transitionId,
      input,
    );
    const response =
      NarrativeTransitionDtoMapper.toAssertionResponse(detail);

    return success(c, assertionResponseSchema.parse(response), 201);
  }

  // Flat path, not nested under its transition, and the asymmetry with addAssertion
  // is intentional (D10). `deleteAssertion` and `applyAssertion` are keyed on the
  // assertion id ALONE (`NarrativeTransitionService.ts:502-504,537-539`); a
  // `/narrative-transitions/:id/assertions/:effectId` URL would advertise a
  // containment check that never runs, so a mismatched pair would succeed while
  // reading as if it had been verified. `addAssertion` stays nested because it
  // genuinely needs the parent id.
  async deleteAssertion(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const effectId = requireRouteParameter(
      c,
      ASSERTION_ID_PARAMETER,
      TRANSITION_EFFECT_NOT_FOUND,
    );
    const member = requireProjectMember(c);

    await this.narrativeTransitionService.deleteAssertion(
      projectId,
      effectId,
      NarrativeTransitionDtoMapper.toMutateTransitionInput(userId, {
        role: member.role,
        canDelete: member.canDelete,
      }),
    );

    return success(c, null, 200);
  }

  // POST, and 200 rather than 201: apply creates no resource of its own — it
  // mutates the target entity and fills `applied_at` on a row that already
  // exists. It is also idempotent by construction (the claim is a conditional
  // write, so a second caller matches no row and is told `already-applied`,
  // `flow_10:101,115`), so a repeat returns the same applied assertion instead of
  // failing, and a caller that retries after a dropped connection gets the truth
  // rather than a conflict. Read `FOR UPDATE` + re-check until gerbang G2 (G2-2).
  async applyAssertion(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const effectId = requireRouteParameter(
      c,
      ASSERTION_ID_PARAMETER,
      TRANSITION_EFFECT_NOT_FOUND,
    );
    const member = requireProjectMember(c);

    const detail = await this.narrativeTransitionService.applyAssertion(
      projectId,
      effectId,
      NarrativeTransitionDtoMapper.toMutateTransitionInput(userId, {
        role: member.role,
        canDelete: member.canDelete,
      }),
    );
    const response =
      NarrativeTransitionDtoMapper.toAssertionResponse(detail);

    return success(c, assertionResponseSchema.parse(response));
  }

  // Bulk apply (D9): every pending assertion of one transition, in ONE transaction,
  // all-or-nothing (notes §10 decision 4). The response is the whole transition
  // afterwards — the same shape GET returns — and NOT a per-assertion report, on
  // purpose: a `{ succeeded, failed }` body would be the wire making room for
  // partial success, and partial success is precisely what this endpoint refuses
  // to have. Nothing applied means nothing changed and the caller gets the
  // error; everything applied means `status` reads `fully_applied`.
  async applyTransition(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const transitionId = requireRouteParameter(
      c,
      NARRATIVE_TRANSITION_ID_PARAMETER,
      NARRATIVE_TRANSITION_NOT_FOUND,
    );
    const member = requireProjectMember(c);

    const detail = await this.narrativeTransitionService.applyTransition(
      projectId,
      transitionId,
      NarrativeTransitionDtoMapper.toMutateTransitionInput(userId, {
        role: member.role,
        canDelete: member.canDelete,
      }),
    );
    const response =
      NarrativeTransitionDtoMapper.toNarrativeTransitionResponse(detail);

    return success(c, narrativeTransitionResponseSchema.parse(response));
  }
}

export function createNarrativeTransitionController({
  narrativeTransitionService,
}: {
  narrativeTransitionService: NarrativeTransitionService;
}): NarrativeTransitionController {
  return new NarrativeTransitionController(narrativeTransitionService);
}
