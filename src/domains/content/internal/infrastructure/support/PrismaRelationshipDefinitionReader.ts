import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { RelationshipDefinitionReader } from "../../application/ports/RelationshipDefinitionReader.js";
import type {
  RelationshipDefinition,
  RelationshipSignature,
} from "../../domain/support/relationshipDefinition.js";

// A `Prisma.TransactionClient` satisfies this shape structurally, which is how
// the 7.7 apply path reads definitions inside the transition's transaction.
export type RelationshipDefinitionDatabase = Pick<
  PrismaClient,
  "relationshipDefinition"
>;

type DefinitionRow = {
  id: string;
  predicate: string;
  directionality: "directional" | "non_directional";
  objectRequired: boolean;
  inverseLabel: string;
  signatures: ReadonlyArray<{
    subjectEntityType: RelationshipSignature["subjectEntityType"];
    objectEntityType: RelationshipSignature["objectEntityType"];
  }>;
};

// `select` rather than the whole row, and not for bytes: `transitive` and
// `subclassOfId` are the rule engine's, and a reader that never fetches them
// cannot hand the content domain a field it has no business acting on
// (`relationshipDefinition.ts` — the domain type deliberately omits them). `id`
// is fetched because an assertion references the predicate BY id.
const DEFINITION_SELECT = {
  id: true,
  predicate: true,
  directionality: true,
  objectRequired: true,
  inverseLabel: true,
  signatures: {
    select: { subjectEntityType: true, objectEntityType: true },
  },
} as const;

function toDefinition(row: DefinitionRow): RelationshipDefinition {
  return {
    id: row.id,
    predicate: row.predicate,
    directionality: row.directionality,
    objectRequired: row.objectRequired,
    inverseLabel: row.inverseLabel,
    signatures: row.signatures.map((signature) => ({
      subjectEntityType: signature.subjectEntityType,
      objectEntityType: signature.objectEntityType,
    })),
  };
}

export class PrismaRelationshipDefinitionReader
  implements RelationshipDefinitionReader
{
  constructor(private readonly client: RelationshipDefinitionDatabase) {}

  // Scoped by `projectId` as well as by predicate, never by predicate alone: the
  // vocabulary is per-project, so a name that exists in someone else's project
  // must read as missing here. The composite unique `(project_id, predicate)` is
  // what makes this a single index hit.
  async findByPredicate(
    projectId: string,
    predicate: string,
  ): Promise<RelationshipDefinition | null> {
    const row = await this.client.relationshipDefinition.findUnique({
      where: { projectId_predicate: { projectId, predicate } },
      select: DEFINITION_SELECT,
    });

    return row ? toDefinition(row) : null;
  }

  async findAllByProject(
    projectId: string,
  ): Promise<ReadonlyMap<string, RelationshipDefinition>> {
    const rows = await this.client.relationshipDefinition.findMany({
      where: { projectId },
      select: DEFINITION_SELECT,
    });

    return new Map(rows.map((row) => [row.predicate, toDefinition(row)]));
  }
}

export function createRelationshipDefinitionReader({
  prisma,
}: {
  prisma: PrismaClient;
}): RelationshipDefinitionReader {
  return new PrismaRelationshipDefinitionReader(prisma);
}
