import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  ChangeEventStatusInput,
  CreateEventInput,
  EventDetail,
  UpdateEventInput,
} from "../../../application/world/EventService.js";
import type { ChangeEventStatusRequestDto } from "../../dto/world/changeEventStatusSchema.js";
import type {
  CreateEventRequestDto,
  CreateEventResponseDto,
} from "../../dto/world/createEventSchema.js";
import type {
  EventListResponseDto,
  EventResponseDto,
} from "../../dto/world/eventResponseSchema.js";
import type { UpdateEventRequestDto } from "../../dto/world/updateEventSchema.js";

// Bridges DTO <-> the Input/Output types EventService.ts already defines — never touches
// the Event domain entity directly (mirrors WorldElementDtoMapper.ts).
export const EventDtoMapper = {
  toCreateEventInput(
    dto: CreateEventRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreateEventInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      title: dto.title,
      era: dto.era,
      timelineOrder: dto.timelineOrder,
      eventType: dto.eventType,
      significance: dto.significance,
      description: dto.description,
      content: dto.content,
    };
  },

  toCreateEventResponse(eventId: string): CreateEventResponseDto {
    return { eventId };
  },

  toEventResponse(detail: EventDetail): EventResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      title: detail.title,
      era: detail.era,
      timelineOrder: detail.timelineOrder,
      eventType: detail.eventType,
      significance: detail.significance,
      description: detail.description,
      content: detail.content,
      status: detail.status,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toEventListResponse(details: EventDetail[]): EventListResponseDto {
    return {
      events: details.map((d) => EventDtoMapper.toEventResponse(d)),
    };
  },

  toUpdateEventInput(
    dto: UpdateEventRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateEventInput {
    return {
      requestingUserId,
      requestingMembership,
      title: dto.title,
      era: dto.era,
      timelineOrder: dto.timelineOrder,
      eventType: dto.eventType,
      significance: dto.significance,
      description: dto.description,
      content: dto.content,
    };
  },

  toChangeEventStatusInput(
    dto: ChangeEventStatusRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): ChangeEventStatusInput {
    return {
      requestingUserId,
      requestingMembership,
      status: dto.status,
    };
  },
};
