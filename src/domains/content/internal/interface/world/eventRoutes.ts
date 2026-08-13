import { Hono } from "hono";

import type { EventController } from "./EventController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createEventRoutes({
  eventController,
}: {
  eventController: EventController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/events", (c) => eventController.createEvent(c));
  routes.get("/:projectId/events", (c) => eventController.listEvents(c));
  routes.get("/:projectId/events/:eventId", (c) => eventController.getEvent(c));
  routes.patch("/:projectId/events/:eventId", (c) =>
    eventController.updateEvent(c),
  );
  routes.patch("/:projectId/events/:eventId/status", (c) =>
    eventController.changeEventStatus(c),
  );
  routes.delete("/:projectId/events/:eventId", (c) =>
    eventController.deleteEvent(c),
  );

  return routes;
}
