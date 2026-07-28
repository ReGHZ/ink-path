import { Hono, type MiddlewareHandler } from "hono";

import type { CharacterController } from "./CharacterController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createCharacterRoutes({
  characterController,
  authMiddleware,
  projectMemberMiddleware,
}: {
  characterController: CharacterController;
  authMiddleware: MiddlewareHandler<AppEnvironment>;
  projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.use("*", authMiddleware);
  routes.use("/:projectId/*", projectMemberMiddleware);

  routes.post("/:projectId/characters", (c) =>
    characterController.createCharacter(c),
  );
  routes.get("/:projectId/characters", (c) =>
    characterController.listCharacters(c),
  );
  routes.get("/:projectId/characters/:characterId", (c) =>
    characterController.getCharacter(c),
  );
  routes.patch("/:projectId/characters/:characterId", (c) =>
    characterController.updateCharacter(c),
  );
  routes.patch("/:projectId/characters/:characterId/status", (c) =>
    characterController.changeCharacterStatus(c),
  );
  routes.delete("/:projectId/characters/:characterId", (c) =>
    characterController.deleteCharacter(c),
  );

  return routes;
}
