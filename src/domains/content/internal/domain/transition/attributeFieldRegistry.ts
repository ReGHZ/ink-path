import type { ContentEntityType } from "../support/ContentRevision.js";

// Which entity fields an `attribute_change` effect is allowed to write, per
// entity type. Decision D1 of Blok B
// (`notes/phase-7-narrative-transition.md` §3), and the reason this file exists
// at all: `transition_effects.field_path` is a plain TEXT column with no CHECK
// (`03-database-design/16_narrative_transition_tables.md:99`), while
// `target_entity_type` spans all nine content entity types. Without a closed
// list, "declare an effect" is a write primitive for any column of any table —
// the caller picks the field name, and apply obeys.
//
// The list mirrors the `fields` record of each descriptor in
// `../../infrastructure/ContentEntityDescriptors.ts`, which the embedding worker
// already maintains per type. Same reason `entityName` was derived from that
// table in 7.4b rather than given its own per-type function: a second per-type
// table would have to be kept in sync by hand, and forgetting one half would
// only ever surface at runtime, for one entity type.
//
// TWO EXCLUSIONS, both deliberate, neither of them accidental gaps:
//
//   `status` — every one of the nine types has one, and in this project it is
//   ALWAYS the editorial lifecycle, never narrative state: `draft/active/
//   archived`, `outline/draft/review/published`, `draft/published`
//   (`prisma/content-story.prisma:1-29`, `content-world.prisma:1-20`). There is
//   no `dead`/`exiled` anywhere in the baseline, so the canonical example in the
//   design draft ("Character(King).status → dead",
//   `notes/NARRATIVE_TRANSITION_DRAFT.md:20`) is not expressible and must not be
//   read as a specification. Allowing it would also hand `attribute_change` a
//   generic setter for `chapters.status`, bypassing the five Flow 5 transition
//   methods that Phase 6 locked in (`.ai/current.md:29-31`).
//
//   `content` — the manuscript body. That belongs to the editor and, later, the
//   live-editing layer (`notes/collab-editing-layer-design.md`), not to a
//   one-line intent recorded at declaration time and applied who-knows-when.
//
// Neither field appears in a descriptor's `fields` record today either, since
// neither is embedded. That is a coincidence of two different criteria agreeing,
// not a guarantee — hence the exclusions are stated here explicitly instead of
// being left to fall out of the embedding field list.
//
// WHAT THIS FILE DOES NOT GUARANTEE: that a domain field named here actually
// exists on the aggregate. Nothing at this layer can check that — the names on
// the right are strings until something dereferences them. The guarantee lands
// in 7.7, where the per-type mutator dispatch is written against each
// aggregate's own `Update*DetailsProperties` type and a wrong name becomes a
// compile error. Until then this table was verified by hand against all nine of
// those types (2026-08-16).
export type WritableAttributeFields = Readonly<Record<string, string>>;

// Keys are the WIRE names — what a client sends as `field_path` and what is
// stored in the column. Values are the DOMAIN property names accepted by the
// aggregate's `updateDetails()`. The two differ exactly once (`event_type` →
// `eventType`), and that single case is why the mapping is data instead of a
// `toCamelCase()` call at the apply site: a helper would silently invent
// property names for every future field, and be wrong the first time a wire
// name is not a pure snake_case rendering of the domain one.
//
// Keyed by the `ContentEntityType` union, like the descriptor table itself: a
// tenth entity type fails to COMPILE here until its writable fields are decided,
// instead of quietly having none.
const WRITABLE_ATTRIBUTE_FIELDS: Readonly<
  Record<ContentEntityType, WritableAttributeFields>
> = {
  layer: {
    name: "name",
    // The only value in this whole table that is not free text: `LayerExposure`
    // is a closed union (`../world/Layer.ts:6-9`). No narrowing happens here —
    // `Layer.validate()` already rejects a value outside the union
    // (`../world/Layer.ts:268`), so apply hands the string over and the target
    // aggregate refuses it. One owner for the rule, not two.
    exposure: "exposure",
    description: "description",
  },

  map: {
    name: "name",
    scale: "scale",
    terrain: "terrain",
    environment: "environment",
    description: "description",
  },

  world_element: {
    name: "name",
    category: "category",
    description: "description",
  },

  faction: {
    name: "name",
    description: "description",
    background: "background",
    ideology: "ideology",
    size: "size",
  },

  character: {
    name: "name",
    archetype: "archetype",
    background: "background",
    personality: "personality",
    goal: "goal",
    description: "description",
  },

  event: {
    title: "title",
    era: "era",
    event_type: "eventType",
    significance: "significance",
    description: "description",
  },

  plot: {
    name: "name",
    theme: "theme",
    conflict: "conflict",
    resolution: "resolution",
    description: "description",
  },

  chapter: {
    title: "title",
    summary: "summary",
  },

  scene: {
    title: "title",
    summary: "summary",
  },
};

// `null` for a field this entity type may not write, so the caller cannot
// accidentally treat "not allowed" as "allowed, name unchanged" — which is what
// returning `fieldPath` unchanged on a miss would have done.
//
// `Object.hasOwn` rather than `in`: `fieldPath` is caller-supplied text, and
// `in` would answer true for `toString` or `constructor` and then hand the apply
// path a "domain field name" borrowed from Object.prototype.
export function domainAttributeFieldOf(
  entityType: ContentEntityType,
  fieldPath: string,
): string | null {
  const fields = WRITABLE_ATTRIBUTE_FIELDS[entityType];

  return Object.hasOwn(fields, fieldPath) ? (fields[fieldPath] ?? null) : null;
}

// Defined in terms of the lookup rather than beside it: two independent
// implementations of "is this allowed" is how a guard and the write it guards
// end up disagreeing.
export function isWritableAttributeField(
  entityType: ContentEntityType,
  fieldPath: string,
): boolean {
  return domainAttributeFieldOf(entityType, fieldPath) !== null;
}

// Sorted so the list an error message shows is stable across runs, and so a test
// comparing it does not depend on object literal order.
export function writableAttributeFieldsOf(
  entityType: ContentEntityType,
): readonly string[] {
  return Object.keys(WRITABLE_ATTRIBUTE_FIELDS[entityType]).sort();
}
