import { randomUUID } from "node:crypto";

import { isUniqueViolation } from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  RelationshipDefinitionCatalogError,
  type ConflictingDefinition,
} from "../../domain/support/RelationshipDefinitionCatalogError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { RelationshipDefinitionCatalog } from "../../application/ports/RelationshipDefinitionCatalog.js";
import type {
  RelationshipDefinitionDetail,
  RelationshipDefinitionDraft,
} from "../../domain/support/relationshipDefinition.js";

export type RelationshipDefinitionCatalogDatabase = Pick<
  PrismaClient,
  "relationshipDefinition"
>;

const DETAIL_SELECT = {
  id: true,
  predicate: true,
  directionality: true,
  objectRequired: true,
  inverseLabel: true,
  displayLabel: true,
  inverseDisplayLabel: true,
  signatures: {
    select: { subjectEntityType: true, objectEntityType: true },
  },
} as const;

type DetailRow = {
  id: string;
  predicate: string;
  directionality: RelationshipDefinitionDetail["directionality"];
  objectRequired: boolean;
  inverseLabel: string;
  displayLabel: string;
  inverseDisplayLabel: string;
  signatures: ReadonlyArray<{
    subjectEntityType: RelationshipDefinitionDetail["signatures"][number]["subjectEntityType"];
    objectEntityType: RelationshipDefinitionDetail["signatures"][number]["objectEntityType"];
  }>;
};

function toDetail(row: DetailRow): RelationshipDefinitionDetail {
  return {
    id: row.id,
    predicate: row.predicate,
    directionality: row.directionality,
    objectRequired: row.objectRequired,
    inverseLabel: row.inverseLabel,
    displayLabel: row.displayLabel,
    inverseDisplayLabel: row.inverseDisplayLabel,
    signatures: row.signatures.map((signature) => ({
      subjectEntityType: signature.subjectEntityType,
      objectEntityType: signature.objectEntityType,
    })),
  };
}

export class PrismaRelationshipDefinitionCatalog
  implements RelationshipDefinitionCatalog
{
  constructor(private readonly client: RelationshipDefinitionCatalogDatabase) {}

  async create(
    projectId: string,
    draft: RelationshipDefinitionDraft,
  ): Promise<RelationshipDefinitionDetail> {
    try {
      // Nested create, so the definition and its signatures land together: a
      // definition with no signature row is the exact state
      // `draftRelationshipDefinition()` refuses to produce, and it must not be
      // reachable through a half-failed write either.
      const row = await this.client.relationshipDefinition.create({
        data: {
          id: randomUUID(),
          projectId,
          predicate: draft.predicate,
          directionality: draft.directionality,
          objectRequired: draft.objectRequired,
          inverseLabel: draft.inverseLabel,
          displayLabel: draft.displayLabel,
          inverseDisplayLabel: draft.inverseDisplayLabel,
          signatures: {
            create: draft.signatures.map((signature) => ({
              id: randomUUID(),
              subjectEntityType: signature.subjectEntityType,
              objectEntityType: signature.objectEntityType,
            })),
          },
        },
        select: DETAIL_SELECT,
      });

      return toDetail(row);
    } catch (error) {
      // Either unique index can land here — `@@unique([projectId, predicate])`
      // over the SYMBOL, or the expression index over the normalized LABEL.
      // Translated HERE, at the port boundary, and NOT classified as transient:
      // two authors naming one predicate is a user-facing conflict, not
      // something a retry fixes.
      //
      // NOT split by which index fired, unlike PrismaSceneRepository /
      // PrismaContentRelationshipRepository — and the difference is that their
      // two indexes mean two different things to the caller (a retryable
      // conflict vs a user-fixable duplicate), while both of these mean the one
      // sentence this port promises: "this project already names that
      // predicate". `matchesUniqueConstraint` would also have to match an
      // EXPRESSION index, which Prisma reports by expression text rather than by
      // columns. What the caller still needs is the winning row's wording, and
      // the lookup below answers that the same way for either index.
      if (isUniqueViolation(error)) {
        throw new RelationshipDefinitionCatalogError(
          draft.predicate,
          await this.findConflicting(projectId, draft),
        );
      }

      throw error;
    }
  }

  // A READ ON THE ERROR PATH, and no other adapter in this codebase has one —
  // so the reason is written here rather than left to be discovered. It is NOT
  // a read-before-write: it runs only after the index has already refused the
  // write, so there is nothing left to race (the G2 TOCTOU lesson is intact).
  // It exists because the author cannot act on a conflict they cannot find:
  // told *"a predicate that reads 'mati fisik' already exists"* when the row on
  // the list reads `mati (fisik)`, they search for text that is not there
  // (gate B8-2), and told about punctuation when what actually clashed was
  // ARITY, they fix the wrong thing (gate B8P-3).
  //
  // TWO exact keys, no expression: `predicate` catches the case where two
  // wordings reduce to one symbol, `display_label` catches the case where the
  // symbol is opaque (`結婚`) and the wording is what repeated. Deliberately NOT
  // the normalized expression the index uses — repeating
  // `lower(normalize(btrim(...), NFKC))` in TypeScript would make this a SECOND
  // OWNER of a rule the database already owns, and the two would drift. The
  // residue is stated rather than hidden: when the two rows meet ONLY after
  // normalization (case, padding, Hangul/Kana variants) this finds nothing, and
  // the generic answer the service then gives — "punctuation and letter case do
  // not distinguish two predicates" — is the true explanation for exactly that
  // case.
  //
  // Failure DEGRADES to null, it does not replace the conflict. Without the
  // catch a dead pool or a statement timeout on this decoration turns a 409 into
  // a 500 and loses the P2002 entirely (gate B8P-1) — and this path runs while
  // the system is under concurrent use, which is when the pool is tightest.
  private async findConflicting(
    projectId: string,
    draft: RelationshipDefinitionDraft,
  ): Promise<ConflictingDefinition | null> {
    try {
      const row = await this.client.relationshipDefinition.findFirst({
        where: {
          projectId,
          OR: [
            { predicate: draft.predicate },
            { displayLabel: draft.displayLabel },
          ],
        },
        select: { displayLabel: true, objectRequired: true },
      });

      return row === null
        ? null
        : { displayLabel: row.displayLabel, objectRequired: row.objectRequired };
    } catch {
      return null;
    }
  }

  async listDetails(
    projectId: string,
  ): Promise<readonly RelationshipDefinitionDetail[]> {
    // `projectId` is in the WHERE, not applied after the fact: the tenancy
    // lesson from G2-3 is that the predicate belongs inside the statement.
    // Ordered by the SYMBOL rather than by display text — the symbol is stable
    // and script-independent, so the list does not reshuffle when an author
    // edits a label, and no collation has to be chosen for text that can be in
    // any script.
    const rows = await this.client.relationshipDefinition.findMany({
      where: { projectId },
      select: DETAIL_SELECT,
      orderBy: { predicate: "asc" },
    });

    return rows.map(toDetail);
  }
}

export function createRelationshipDefinitionCatalog({
  prisma,
}: {
  prisma: PrismaClient;
}): RelationshipDefinitionCatalog {
  return new PrismaRelationshipDefinitionCatalog(prisma);
}
