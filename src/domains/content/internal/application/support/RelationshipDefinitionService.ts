import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import {
  draftRelationshipDefinition,
  symbolFromLabel,
  type RelationDirectionality,
  type RelationshipDefinitionDetail,
  type RelationshipSignature,
} from "../../domain/support/relationshipDefinition.js";
import {
  RelationshipDefinitionCatalogError,
  type ConflictingDefinition,
} from "../../domain/support/RelationshipDefinitionCatalogError.js";

import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { RelationshipDefinitionCatalog } from "../ports/RelationshipDefinitionCatalog.js";

// LABEL-FIRST, and that is the decision: the author types the word they would
// use and answers one question about arity
// (`notes/usulan-ux-pencatatan-fakta.md` §8.3). The symbol is derived below and
// never asked for.
export type CreateRelationshipDefinitionInput = {
  projectId: string;
  requestingMembership: ProjectMembership;
  label: string;
  // Absent means "the other direction reads the same" — exactly what the
  // non-directional predicates among the 19 seeded ones already do
  // (`inverse_label` equals `predicate`).
  inverseLabel: string | null;
  objectRequired: boolean;
  // Absent means the author was not asked (`notes/usulan-ux-pencatatan-fakta.md`
  // §9.4). The default lands below, beside the one for `inverseLabel`, because
  // symmetry is a WRITE-TIME behaviour — it rewrites canonical orientation — and
  // that rule belongs to this layer rather than to a request schema.
  directionality: RelationDirectionality | null;
  signatures: readonly RelationshipSignature[];
};

// Same guard as `RelationshipService`, same reason: a Reviewer reads the world,
// it does not decide what that world's vocabulary is. `can_delete` plays no part
// because nothing here deletes (see the note on the missing DELETE below).
function assertCanWrite(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Reviewer role cannot modify the project vocabulary",
    );
  }
}

// Same shape as `mapRelationshipError` / `mapCharacterError`: every DomainError
// out of `draftRelationshipDefinition()` is a shape violation the caller can fix
// — a predicate that is not snake_case, a signature with the wrong arity, a
// structural hierarchy pair. Without this branch `errorHandler.ts` only
// special-cases AppError, so "structural hierarchy" would reach the client as a
// raw 500 instead of the 400 every other content write answers. Proven by the
// e2e case for the hierarchy pair, which saw exactly that 500 first.
function mapRelationshipDefinitionError(error: unknown): never {
  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

// Names the LABEL, never the derived symbol: the author never typed the symbol,
// and for a label in another script it would name `p_1a2b3c4d`.
//
// And it names the label of the row that ALREADY EXISTS, not the one just typed
// — two labels can derive one symbol ("mati (fisik)" and "mati fisik" both give
// `mati_fisik`), so echoing the typed text sends the author looking through the
// list for words that are not in it (gate B8-2).
//
// The arity branch is `notes/usulan-ux-pencatatan-fakta.md` §9.3 output #2 —
// "bentrok aritas ditolak dengan pesan tentang aritas". One name is one arity
// per project (§9.2: that IS what `@@unique([project_id, predicate])` means
// here), so `mati/1` after `mati/2` is a real conflict — it just is not the
// same conflict as typing one word twice, and must not be reported as one.
function conflictMessage(
  typedLabel: string,
  objectRequired: boolean,
  existing: ConflictingDefinition | null,
): string {
  if (existing === null) {
    return `This project already has a predicate that reads "${typedLabel}" (punctuation and letter case do not distinguish two predicates)`;
  }

  if (existing.objectRequired !== objectRequired) {
    return `This project already has a predicate that reads "${existing.displayLabel}", and it ${existing.objectRequired ? "takes an object" : "takes no object"} — one name is one arity per project, so it cannot also be defined ${objectRequired ? "with" : "without"} one`;
  }

  if (existing.displayLabel !== typedLabel) {
    return `This project already has a predicate that reads "${existing.displayLabel}", and "${typedLabel}" is the same word to this system (punctuation and letter case do not distinguish two predicates)`;
  }

  return `This project already has a predicate that reads "${existing.displayLabel}"`;
}

export class RelationshipDefinitionService {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly relationshipDefinitionCatalog: RelationshipDefinitionCatalog,
  ) {}

  // NO update and NO delete in this slice, and neither is an oversight:
  //   * rename — the FK from `content_relationships` and `assertions` is
  //     `ON UPDATE RESTRICT` over `(project_id, predicate)`, so the DATABASE
  //     refuses a rename while any fact names the predicate. Allowing it needs a
  //     product decision (rewrite the facts? forbid it? alias?), not a route.
  //     Most of the motive dissolved anyway: what an author usually wants to fix
  //     is the TEXT, and the text is its own column now.
  //   * delete — the same FK is `ON DELETE RESTRICT`, so a used predicate cannot
  //     be dropped, and "deactivate instead" has no column to write to.
  // Both are written down in `.ai/current.md` rather than half-built here.
  async createDefinition(
    input: CreateRelationshipDefinitionInput,
  ): Promise<RelationshipDefinitionDetail> {
    assertCanWrite(input.requestingMembership);

    const displayLabel = input.label;
    const inverseDisplayLabel = input.inverseLabel ?? input.label;
    const directionality = input.directionality ?? "directional";

    const predicate =
      symbolFromLabel(displayLabel) ?? this.generateOpaqueSymbol();
    const inverseSymbol = symbolFromLabel(inverseDisplayLabel) ?? predicate;

    // Shape rules FIRST, before the write: a malformed predicate must cost one
    // function call, not a round trip.
    let draft;

    try {
      draft = draftRelationshipDefinition({
        predicate,
        directionality,
        objectRequired: input.objectRequired,
        inverseLabel: inverseSymbol,
        displayLabel,
        inverseDisplayLabel,
        signatures: input.signatures,
      });
    } catch (error) {
      mapRelationshipDefinitionError(error);
    }

    try {
      return await this.relationshipDefinitionCatalog.create(
        input.projectId,
        draft,
      );
    } catch (error) {
      // Read-before-write is deliberately ABSENT: the unique index is the
      // arbiter, so two concurrent creates of one predicate cannot both pass a
      // check and then both write. The translation lives here because the port's
      // error is domain-shaped, not Prisma-shaped.
      if (error instanceof RelationshipDefinitionCatalogError) {
        throw new AppError(
          ErrorCode.CONFLICT,
          conflictMessage(displayLabel, input.objectRequired, error.existing),
        );
      }

      throw error;
    }
  }

  async listDefinitions(
    projectId: string,
  ): Promise<readonly RelationshipDefinitionDetail[]> {
    // Ordering belongs to the adapter (by SYMBOL, script-independent), so this
    // stays a pass-through rather than sorting display text with a collation
    // nobody chose.
    return this.relationshipDefinitionCatalog.listDetails(projectId);
  }

  // Opaque symbol for a label no ASCII survives (`結婚`, `الزواج`). It is a
  // machine key: nothing renders it, the author never types it, and the only
  // property it needs is being unique inside the project — which the unique
  // index guarantees, not this function.
  private generateOpaqueSymbol(): string {
    const raw = this.idGenerator
      .generate()
      .replaceAll(/[^a-z0-9]/gi, "")
      .slice(0, 12)
      .toLowerCase();

    return `p_${raw}`;
  }
}

export function createRelationshipDefinitionService({
  idGenerator,
  relationshipDefinitionCatalog,
}: {
  idGenerator: IdGenerator;
  relationshipDefinitionCatalog: RelationshipDefinitionCatalog;
}): RelationshipDefinitionService {
  return new RelationshipDefinitionService(
    idGenerator,
    relationshipDefinitionCatalog,
  );
}
