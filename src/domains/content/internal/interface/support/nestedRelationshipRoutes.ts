import type { ContentEntityType } from "../../domain/support/ContentRevision.js";

export type NestedRelationshipRoute = {
  // Path segment as it already exists in Phase 4-6 routers — `world-maps`, not
  // `maps` (K6: the running code wins over `02-system-design/05_api_design.md`).
  segment: string;
  parameterName: string;
  // Reused verbatim from each entity's own controller so a missing id answers
  // the same 404 message on `/characters/:characterId/relationships` as on
  // `/characters/:characterId`.
  notFoundMessage: string;
};

// The nine nested list routes as DATA, keyed by the entity type they carry.
//
// `satisfies Record<ContentEntityType, …>` is the load-bearing part: adding a
// tenth content entity type breaks THIS build until its relationship route is
// declared, which is the same guarantee `ContentEntityDescriptors.ts` gives the
// locator (notes §10 — "tidak ada 'separuh locate' yang bisa terlupa"). Nine
// hand-written route lines would have given the opposite: a silent gap.
//
// K6 is still satisfied — `entityType` reaches the controller as a compile-time
// constant taken from this table's keys, never parsed out of the URL.
//
// What `test/integration/route-protection.end2end.test.ts` proves about these
// paths, exactly: its 401/404 sweeps enumerate `app.routes` at runtime, so every
// path this loop generates IS checked for "no token" and "non-member" — nothing
// to add per phase. What that sweep canNOT see is a path that stopped existing,
// which is why the same file also carries a presence entry per router; the two
// relationship entries are there. The happy-path e2e (create/list/patch/delete
// over HTTP) is 7.4 item 12-13 and does not exist yet.
export const NESTED_RELATIONSHIP_ROUTES = {
  layer: {
    segment: "layers",
    parameterName: "layerId",
    notFoundMessage: "Layer not found",
  },
  map: {
    segment: "world-maps",
    parameterName: "worldMapId",
    notFoundMessage: "World map not found",
  },
  character: {
    segment: "characters",
    parameterName: "characterId",
    notFoundMessage: "Character not found",
  },
  faction: {
    segment: "factions",
    parameterName: "factionId",
    notFoundMessage: "Faction not found",
  },
  world_element: {
    segment: "world-elements",
    parameterName: "worldElementId",
    notFoundMessage: "World element not found",
  },
  event: {
    segment: "events",
    parameterName: "eventId",
    notFoundMessage: "Event not found",
  },
  plot: {
    segment: "plots",
    parameterName: "plotId",
    notFoundMessage: "Plot not found",
  },
  chapter: {
    segment: "chapters",
    parameterName: "chapterId",
    notFoundMessage: "Chapter not found",
  },
  scene: {
    segment: "scenes",
    parameterName: "sceneId",
    notFoundMessage: "Scene not found",
  },
} as const satisfies Record<ContentEntityType, NestedRelationshipRoute>;
