import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changeCharacterStatusSchema } from "../dto/story/changeCharacterStatusSchema.js";
import {
  characterListResponseSchema,
  characterResponseSchema,
} from "../dto/story/characterResponseSchema.js";
import {
  createCharacterResponseSchema,
  createCharacterSchema,
} from "../dto/story/createCharacterSchema.js";
import { updateCharacterSchema } from "../dto/story/updateCharacterSchema.js";
import { CharacterDtoMapper } from "../mappers/story/CharacterDtoMapper.js";

import type { CharacterService } from "../../application/story/CharacterService.js";
import type { Context } from "hono";

export class CharacterController {
  constructor(private readonly characterService: CharacterService) {}

  async createCharacter(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createCharacterSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);

    const member = requireProjectMember(c);
    const input = CharacterDtoMapper.toCreateCharacterInput(
      dto,
      userId,
      projectId,
      {
        role: member.role,
        canDelete: member.canDelete,
      },
    );

    const result = await this.characterService.createCharacter(input);
    const response = CharacterDtoMapper.toCreateCharacterResponse(
      result.characterId,
    );
    const validatedResponse = createCharacterResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getCharacter(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const characterId = requireRouteParameter(
      c,
      "characterId",
      "Character not found",
    );

    const detail = await this.characterService.getCharacterById(
      projectId,
      characterId,
    );
    const response = CharacterDtoMapper.toCharacterResponse(detail);
    const validatedResponse = characterResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async listCharacters(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details =
      await this.characterService.listCharactersByProject(projectId);
    const response = CharacterDtoMapper.toCharacterListResponse(details);
    const validatedResponse = characterListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateCharacter(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateCharacterSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const characterId = requireRouteParameter(
      c,
      "characterId",
      "Character not found",
    );

    const member = requireProjectMember(c);
    const input = CharacterDtoMapper.toUpdateCharacterInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.characterService.updateCharacter(
      projectId,
      characterId,
      input,
    );
    const response = CharacterDtoMapper.toCharacterResponse(detail);
    const validatedResponse = characterResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async changeCharacterStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changeCharacterStatusSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const characterId = requireRouteParameter(
      c,
      "characterId",
      "Character not found",
    );

    const member = requireProjectMember(c);
    const input = CharacterDtoMapper.toChangeCharacterStatusInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.characterService.changeCharacterStatus(
      projectId,
      characterId,
      input,
    );
    const response = CharacterDtoMapper.toCharacterResponse(detail);
    const validatedResponse = characterResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deleteCharacter(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const characterId = requireRouteParameter(
      c,
      "characterId",
      "Character not found",
    );

    const member = requireProjectMember(c);

    await this.characterService.deleteCharacter(projectId, characterId, {
      requestingUserId: userId,
      requestingMembership: {
        role: member.role,
        canDelete: member.canDelete,
      },
    });

    return success(c, null, 200);
  }
}

export function createCharacterController({
  characterService,
}: {
  characterService: CharacterService;
}): CharacterController {
  return new CharacterController(characterService);
}
