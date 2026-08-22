import { describe, expect, it } from "vitest";

import { createRelationshipDefinitionService } from "./RelationshipDefinitionService.js";
import {
  symbolFromLabel,
  type RelationshipDefinitionDetail,
  type RelationshipDefinitionDraft,
} from "../../domain/support/relationshipDefinition.js";
import {
  RelationshipDefinitionCatalogError,
  type ConflictingDefinition,
} from "../../domain/support/RelationshipDefinitionCatalogError.js";

import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { RelationshipDefinitionCatalog } from "../ports/RelationshipDefinitionCatalog.js";

const projectId = "6e6e6e6e-0000-4000-8000-000000002510";

const writer: ProjectMembership = { role: "writer", canDelete: true };
const editorNoDelete: ProjectMembership = { role: "editor", canDelete: false };
const reviewer: ProjectMembership = { role: "reviewer", canDelete: false };

// Records what the SERVICE decided rather than what the database stored: the two
// things under test here are the derived symbol and the display text, and both
// are settled before the write.
class FakeCatalog implements RelationshipDefinitionCatalog {
  readonly created: Array<{ projectId: string; draft: RelationshipDefinitionDraft }> =
    [];

  constructor(
    private readonly duplicate = false,
    private readonly existing: ConflictingDefinition | null = null,
  ) {}

  create(
    project: string,
    draft: RelationshipDefinitionDraft,
  ): Promise<RelationshipDefinitionDetail> {
    if (this.duplicate) {
      return Promise.reject(
        new RelationshipDefinitionCatalogError(draft.predicate, this.existing),
      );
    }

    this.created.push({ projectId: project, draft });

    return Promise.resolve({ id: "definition-1", ...draft });
  }

  listDetails(): Promise<readonly RelationshipDefinitionDetail[]> {
    return Promise.resolve([
      { id: "definition-2", ...draftOf({ predicate: "zzz_last" }) },
      { id: "definition-3", ...draftOf({ predicate: "aaa_first" }) },
    ]);
  }
}

function draftOf(
  overrides: Partial<RelationshipDefinitionDraft> = {},
): RelationshipDefinitionDraft {
  return {
    predicate: "mentors",
    directionality: "directional",
    objectRequired: true,
    inverseLabel: "mentored_by",
    displayLabel: "mentors",
    inverseDisplayLabel: "mentored by",
    signatures: [
      { subjectEntityType: "character", objectEntityType: "character" },
    ],
    ...overrides,
  };
}

const idGenerator: IdGenerator = {
  generate: () => "1a2b3c4d-5e6f-4000-8000-000000000000",
};

function createService(catalog: RelationshipDefinitionCatalog) {
  return createRelationshipDefinitionService({
    idGenerator,
    relationshipDefinitionCatalog: catalog,
  });
}

function input(
  overrides: Partial<Parameters<
    ReturnType<typeof createService>["createDefinition"]
  >[0]> = {},
) {
  return {
    projectId,
    requestingMembership: writer,
    label: "mentors",
    inverseLabel: null,
    objectRequired: true,
    directionality: "directional" as const,
    signatures: [
      { subjectEntityType: "character" as const, objectEntityType: "character" as const },
    ],
    ...overrides,
  };
}

describe("RelationshipDefinitionService.createDefinition", () => {
  it("derives the symbol from the author's word — nobody types a symbol", async () => {
    const catalog = new FakeCatalog();

    await createService(catalog).createDefinition(
      input({ label: "menikah dengan" }),
    );

    expect(catalog.created[0]?.draft.predicate).toBe("menikah_dengan");
    expect(catalog.created[0]?.draft.displayLabel).toBe("menikah dengan");
  });

  it("falls back to an opaque symbol when no ASCII survives, and KEEPS the word", async () => {
    const catalog = new FakeCatalog();

    await createService(catalog).createDefinition(input({ label: "結婚" }));

    const draft = catalog.created[0]?.draft;

    expect(draft?.predicate).toMatch(/^p_[a-z0-9]+$/);
    // The COUPLING, not the shape: whatever `generateOpaqueSymbol()` mints must
    // fall inside the namespace `symbolFromLabel()` refuses to produce, or a
    // label could collide with a generated symbol. Asserting the regex alone
    // let a generator change (`p_zzz…`) walk straight out of the reserved range
    // with nothing red (gate B8, mutant M-3).
    expect(symbolFromLabel(draft?.predicate ?? "")).toBeNull();
    expect(draft?.displayLabel).toBe("結婚");
    // The symbol is a key, so the inverse side reuses it rather than inventing a
    // second opaque value that means the same thing.
    expect(draft?.inverseLabel).toBe(draft?.predicate);
  });

  it("reads the other direction the same way when the author left it out", async () => {
    const catalog = new FakeCatalog();

    await createService(catalog).createDefinition(
      input({ label: "sekutu", inverseLabel: null }),
    );

    expect(catalog.created[0]?.draft.inverseDisplayLabel).toBe("sekutu");
    expect(catalog.created[0]?.draft.inverseLabel).toBe("sekutu");
  });

  it("derives the inverse symbol from the inverse word when given one", async () => {
    const catalog = new FakeCatalog();

    await createService(catalog).createDefinition(
      input({ label: "mentors", inverseLabel: "dibimbing oleh" }),
    );

    expect(catalog.created[0]?.draft.inverseLabel).toBe("dibimbing_oleh");
    expect(catalog.created[0]?.draft.inverseDisplayLabel).toBe(
      "dibimbing oleh",
    );
  });

  it("passes the project id through to the catalog, never a default", async () => {
    const catalog = new FakeCatalog();

    await createService(catalog).createDefinition(input());

    expect(catalog.created[0]?.projectId).toBe(projectId);
  });

  it("lets an editor without can_delete define vocabulary", async () => {
    const catalog = new FakeCatalog();

    await expect(
      createService(catalog).createDefinition(
        input({ requestingMembership: editorNoDelete }),
      ),
    ).resolves.toMatchObject({ predicate: "mentors" });
  });

  it("refuses a reviewer", async () => {
    const catalog = new FakeCatalog();

    // The CODE, not only the sentence: matching the message alone let
    // `ErrorCode.FORBIDDEN` become `VALIDATION_ERROR` — a 403 silently demoted
    // to 400 — with nothing red (gate B8, mutant M-1). The e2e case asserts the
    // STATUS for the same reason.
    const attempt = createService(catalog).createDefinition(
      input({ requestingMembership: reviewer }),
    );

    await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(attempt).rejects.toThrow(
      /Reviewer role cannot modify the project vocabulary/,
    );

    expect(catalog.created).toHaveLength(0);
  });

  it("refuses a malformed draft BEFORE the write", async () => {
    const catalog = new FakeCatalog();

    await expect(
      createService(catalog).createDefinition(input({ signatures: [] })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(catalog.created).toHaveLength(0);
  });

  it("turns the catalog's duplicate error into a conflict, not a 500", async () => {
    const service = createService(new FakeCatalog(true));

    await expect(service.createDefinition(input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("names the label of the row that ALREADY EXISTS, not the one just typed", async () => {
    const service = createService(
      new FakeCatalog(true, {
        displayLabel: "mati (fisik)",
        objectRequired: true,
      }),
    );

    // The author typed "mati fisik"; the row they have to find in the list reads
    // "mati (fisik)". Echoing what they typed sends them looking for text that is
    // not there (gate B8-2, mutant M-2).
    const attempt = service.createDefinition(input({ label: "mati fisik" }));

    await expect(attempt).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(attempt).rejects.toThrow(/reads "mati \(fisik\)"/);
  });

  it("answers an ARITY clash with a message about arity", async () => {
    const service = createService(
      new FakeCatalog(true, { displayLabel: "mati", objectRequired: false }),
    );

    // `mati/1` already defined, `mati/2` attempted: one name is one arity per
    // project (`notes/usulan-ux-pencatatan-fakta.md` §9.2), so this IS a
    // conflict — just not the "you typed the same word twice" one, and §9.3
    // output #2 says it must not be reported as one.
    const attempt = service.createDefinition(
      input({ label: "mati", objectRequired: true }),
    );

    await expect(attempt).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(attempt).rejects.toThrow(/one name is one arity per project/);
  });
});

describe("RelationshipDefinitionService.listDefinitions", () => {
  it("does NOT re-sort — the adapter owns the order, by symbol", async () => {
    const listed = await createService(new FakeCatalog()).listDefinitions(
      projectId,
    );

    expect(listed.map((detail) => detail.predicate)).toEqual([
      "zzz_last",
      "aaa_first",
    ]);
  });
});
