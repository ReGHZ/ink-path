import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { EvaluationFactReader } from "../domain/EvaluationFactReader.js";
import type { EntityType } from "../domain/ruleAst.js";
import type {
  EvaluationAssertion,
  EvaluationEntity,
  EvaluationPredicate,
  EvaluationSnapshot,
} from "../domain/RuleEvaluator.js";
import type { StoryPosition } from "../domain/storyPosition.js";

// Reads one project's world into the shape the evaluator reasons over.
//
// ⚠ THE ORDERING HERE IS THE ARTIFACT AXIS, NOT THE DIEGETIC ONE. Positions come
// from `chapters.order` and `scenes.order_in_chapter` — the sequence a reader
// turns pages in. Story time is a PARTIAL order derived by reachability over
// assertions (`notes/premis-symbolic-rule-engine.md` §8.2), and no projection
// materialises it yet; that is item 11.4.
//
// For the rules this slice evaluates the two coincide, and not by luck: "died in
// chapter 12, speaks in chapter 30" is a claim an author makes ABOUT CHAPTERS,
// so chapter order is the axis it is stated on. The substitution stops being
// sound the moment a rule asks about flashbacks, where telling order and story
// order come apart — which is why an `event` anchor below resolves to null
// instead of borrowing a position it does not have.
//
// The three entity types below are all this reader can enumerate, and it says so
// in the snapshot rather than leaving the evaluator to infer it from an empty
// list. Six of the grammar's nine types are therefore answered `unsupported`;
// they become answerable when 11.4's projection covers them.
const ENUMERABLE_ENTITY_TYPES: readonly EntityType[] = [
  "character",
  "scene",
  "chapter",
];

export class PrismaEvaluationFactReader implements EvaluationFactReader {
  constructor(private readonly client: PrismaClient) {}

  async read(projectId: string): Promise<EvaluationSnapshot> {
    const [characters, scenes, chapters, definitions, rows] = await Promise.all([
      this.client.character.findMany({
        where: { projectId },
        select: { id: true },
      }),
      this.client.scene.findMany({
        where: { projectId },
        select: { id: true, chapterId: true, orderInChapter: true },
      }),
      this.client.chapter.findMany({
        where: { projectId },
        select: { id: true, order: true },
      }),
      this.client.relationshipDefinition.findMany({
        where: { projectId },
        select: { id: true, objectRequired: true },
      }),
      // No `relationshipDefinitionId: { not: null }` filter. A `terminate` or
      // `retract` is allowed to carry only a parent transition — the
      // `has_provenance` CHECK requires one of the two, not both — so filtering
      // on it here dropped exactly those rows, and a dropped termination reads
      // as a fact that still holds. The mapping below applies the null check
      // where it belongs: to rows becoming assertions, after the retract and
      // terminate sets have been built from all of them.
      this.client.transitionEffect.findMany({
        where: { projectId },
        select: {
          id: true,
          relationshipDefinitionId: true,
          effectType: true,
          targetEntityId: true,
          relatedEntityId: true,
          anchorEntityType: true,
          anchorEntityId: true,
          targetAssertionId: true,
        },
      }),
    ]);

    const chapterOrderById = new Map(
      chapters.map((chapter) => [chapter.id, chapter.order]),
    );
    const scenePositionById = new Map<string, StoryPosition>();

    for (const scene of scenes) {
      const chapterOrder = chapterOrderById.get(scene.chapterId);

      if (chapterOrder !== undefined) {
        scenePositionById.set(scene.id, {
          kind: "scene",
          chapterOrder,
          orderInChapter: scene.orderInChapter,
        });
      }
    }

    const entities: EvaluationEntity[] = [
      // A character is not a story anchor, so it carries no position. The
      // evaluator only ever asks for one when a cut names that binding.
      ...characters.map((character) => ({
        id: character.id,
        entityType: "character" as const,
        position: null,
      })),
      ...scenes.map((scene) => ({
        id: scene.id,
        entityType: "scene" as const,
        position: scenePositionById.get(scene.id) ?? null,
      })),
      ...chapters.map((chapter) => ({
        id: chapter.id,
        entityType: "chapter" as const,
        // A chapter has no position INSIDE itself, which is why this is not a
        // scene position with a made-up index.
        position: { kind: "chapter" as const, chapterOrder: chapter.order },
      })),
    ];

    // Retraction is transaction-time: the claim counts as never having been
    // made, at every cut. Dropped outright rather than folded — there is
    // nothing left to fold.
    const retractedIds = new Set(
      rows
        .filter((row) => row.effectType === "retract")
        .map((row) => row.targetAssertionId)
        .filter((id): id is string => id !== null),
    );

    // Termination is valid-time and deletes nothing: the fact held before its
    // anchor. Collected separately so the evaluator can answer `unknown`
    // instead of pretending in either direction.
    const terminatedIds = new Set(
      rows
        .filter((row) => row.effectType === "terminate")
        .map((row) => row.targetAssertionId)
        .filter((id): id is string => id !== null),
    );

    const assertions: EvaluationAssertion[] = rows
      .filter(
        (
          row,
        ): row is (typeof rows)[number] & { relationshipDefinitionId: string } =>
          row.relationshipDefinitionId !== null &&
          row.effectType !== "retract" &&
          row.effectType !== "terminate" &&
          !retractedIds.has(row.id),
      )
      .map((row) => ({
        definitionId: row.relationshipDefinitionId,
        subjectEntityId: row.targetEntityId,
        objectEntityId: row.relatedEntityId,
        anchorPosition: anchorPositionOf(
          row.anchorEntityType,
          row.anchorEntityId,
          chapterOrderById,
          scenePositionById,
        ),
        terminated: terminatedIds.has(row.id),
      }));

    const predicates: EvaluationPredicate[] = definitions.map((definition) => ({
      id: definition.id,
      objectRequired: definition.objectRequired,
    }));

    return {
      enumerableEntityTypes: ENUMERABLE_ENTITY_TYPES,
      entities,
      predicates,
      assertions,
    };
  }
}

function anchorPositionOf(
  anchorEntityType: "scene" | "event" | "chapter" | null,
  anchorEntityId: string | null,
  chapterOrderById: ReadonlyMap<string, number>,
  scenePositionById: ReadonlyMap<string, StoryPosition>,
): StoryPosition | null {
  if (anchorEntityType === null || anchorEntityId === null) {
    return null;
  }

  if (anchorEntityType === "chapter") {
    const order = chapterOrderById.get(anchorEntityId);

    return order === undefined ? null : { kind: "chapter", chapterOrder: order };
  }

  if (anchorEntityType === "scene") {
    return scenePositionById.get(anchorEntityId) ?? null;
  }

  // An event is placed on the DIEGETIC axis, which nothing builds yet. Null is
  // the honest answer and it propagates to `unsupported`.
  return null;
}

export function createEvaluationFactReader({
  prisma,
}: {
  prisma: PrismaClient;
}): EvaluationFactReader {
  return new PrismaEvaluationFactReader(prisma);
}
