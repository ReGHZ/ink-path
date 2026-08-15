import type { ContentEntityType } from "../../domain/support/ContentRevision.js";

// Answers one question and nothing else: "does this content entity exist, and
// which project owns it?" — registry rules 5, 6 and 7
// (`05-implementation-policy/02_relation_type_registry.md` §4) in a single call
// per endpoint, for both sides of a relationship.
//
// It lives in the CONTENT domain's ports, not in `shared/application/ports/`
// where `ContentEntityReader` sits (notes K3). The reader is up there because
// its consumer is another module (the embedding worker); this port's only
// consumer is RelationshipService, inside this very domain. Adding `locate()`
// to the cross-module port would have forced the worker to carry a method it
// never calls, and made a content-domain need a reason to change a contract the
// worker depends on.
//
// `entityType` is the narrowed `ContentEntityType` union here, unlike
// `ContentEntityReader.read()` which takes a raw string: the reader's callers
// deserialize wire events, whose entity type can legitimately be a value this
// build does not know yet, while this port's callers pass route constants
// (registry §4 rule 2 — entity types are never free text on the write path).
export type ContentEntityLocation = {
  projectId: string;
};

export type ContentEntityLocator = {
  // `null` means "no such row", which the service turns into 404. A row that
  // exists in a DIFFERENT project is NOT distinguished here: the caller
  // compares `projectId` and answers 404 as well, never 403, so the API cannot
  // be used to confirm that another tenant's entity exists (Flow 4 §Create
  // error path, `02-system-design/03_flow_04_content_relationship.md:52`).
  locate(parameters: {
    entityType: ContentEntityType;
    entityId: string;
  }): Promise<ContentEntityLocation | null>;
};
