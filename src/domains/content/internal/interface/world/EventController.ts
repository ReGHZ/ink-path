import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changeEventStatusSchema } from "../dto/world/changeEventStatusSchema.js";
import {
  createEventResponseSchema,
  createEventSchema,
} from "../dto/world/createEventSchema.js";
import {
  eventListResponseSchema,
  eventResponseSchema,
} from "../dto/world/eventResponseSchema.js";
import { updateEventSchema } from "../dto/world/updateEventSchema.js";
import { EventDtoMapper } from "../mappers/world/EventDtoMapper.js";

import type { EventService } from "../../application/world/EventService.js";
import type { Context } from "hono";

export class EventController {
  constructor(private readonly eventService: EventService) {}

  async createEvent(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createEventSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);

    const member = requireProjectMember(c);
    const input = EventDtoMapper.toCreateEventInput(dto, userId, projectId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const result = await this.eventService.createEvent(input);
    const response = EventDtoMapper.toCreateEventResponse(result.eventId);
    const validatedResponse = createEventResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getEvent(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const eventId = requireRouteParameter(c, "eventId", "Event not found");

    const detail = await this.eventService.getEventById(projectId, eventId);
    const response = EventDtoMapper.toEventResponse(detail);
    const validatedResponse = eventResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async listEvents(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details = await this.eventService.listEventsByProject(projectId);
    const response = EventDtoMapper.toEventListResponse(details);
    const validatedResponse = eventListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateEvent(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateEventSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const eventId = requireRouteParameter(c, "eventId", "Event not found");

    const member = requireProjectMember(c);
    const input = EventDtoMapper.toUpdateEventInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.eventService.updateEvent(
      projectId,
      eventId,
      input,
    );
    const response = EventDtoMapper.toEventResponse(detail);
    const validatedResponse = eventResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async changeEventStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changeEventStatusSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const eventId = requireRouteParameter(c, "eventId", "Event not found");

    const member = requireProjectMember(c);
    const input = EventDtoMapper.toChangeEventStatusInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.eventService.changeEventStatus(
      projectId,
      eventId,
      input,
    );
    const response = EventDtoMapper.toEventResponse(detail);
    const validatedResponse = eventResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deleteEvent(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const eventId = requireRouteParameter(c, "eventId", "Event not found");

    const member = requireProjectMember(c);

    await this.eventService.deleteEvent(projectId, eventId, {
      requestingUserId: userId,
      requestingMembership: {
        role: member.role,
        canDelete: member.canDelete,
      },
    });

    return success(c, null, 200);
  }
}

export function createEventController({
  eventService,
}: {
  eventService: EventService;
}): EventController {
  return new EventController(eventService);
}
