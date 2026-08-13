import { Hono } from "hono";

import type { CharacterController } from "./CharacterController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createCharacterRoutes({
  characterController,
}: {
  characterController: CharacterController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

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
