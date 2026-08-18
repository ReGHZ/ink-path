import { fromBoolean, type Truth } from "./threeValued.js";

// Where something sits on the ARTIFACT axis — the order a reader turns pages
// in. Two shapes, because the two are not equally precise, and collapsing that
// difference is a defect this project had already named
// (`notes/phase-11-validation.md`: "Posisi Scene bukan satu integer — ia
// pasangan (chapter.order, order_in_chapter)").
//
// A scene has an exact place: chapter, then position within it. A chapter
// anchor does not — "he died in chapter 12" says nothing about WHERE in chapter
// 12, so against a scene inside chapter 12 it is genuinely undecidable. That is
// the third truth value doing its job, and it is why comparison returns `Truth`
// rather than boolean.
export type StoryPosition =
  | { kind: "scene"; chapterOrder: number; orderInChapter: number }
  | { kind: "chapter"; chapterOrder: number };

// Is `earlier` strictly before `later`?
//
// Strictly, on purpose: something happening AT the cut has not happened before
// it, and a rule about "already dead by the time he speaks" must not fire on
// the death scene itself.
export function strictlyBefore(
  earlier: StoryPosition,
  later: StoryPosition,
): Truth {
  if (earlier.chapterOrder !== later.chapterOrder) {
    return fromBoolean(earlier.chapterOrder < later.chapterOrder);
  }

  // Same chapter. Only two exact positions can be ordered inside it; a chapter
  // anchor on either side leaves the question open, and answering it would mean
  // inventing a position the author never gave.
  if (earlier.kind === "scene" && later.kind === "scene") {
    return fromBoolean(earlier.orderInChapter < later.orderInChapter);
  }

  return "unknown";
}
