import { describe, expect, it } from "vitest";

import { chunkText } from "./chunker.js";

// Simple, deterministic counter for tests — 1 "token" per character. Keeps expected chunk
// boundaries easy to reason about without needing a real tokenizer in unit tests. Production
// wiring supplies the real tokenizer's count instead (see EmbeddingWorker, not this module).
const charCounter = (text: string): number => text.length;
// Every character costs 2 "tokens" here — a counter with no simple 1:1 char relationship, to
// prove the char-budget fallback isn't secretly assuming any particular chars-per-token ratio.
const doubleCounter = (text: string): number => text.length * 2;

// §12 states maxChunkTokens as a hard cap, not a soft target — every test that produces
// multiple chunks should assert this invariant directly, not just check chunk count.
function expectAllWithinCap(
  chunks: Array<{ text: string }>,
  countTokens: (text: string) => number,
  maxChunkTokens: number,
): void {
  for (const chunk of chunks) {
    expect(countTokens(chunk.text)).toBeLessThanOrEqual(maxChunkTokens);
  }
}

describe("chunkText", () => {
  it("returns a single chunk for text within maxChunkTokens", () => {
    const text = "A short backstory about a wandering sage.";

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 500,
    });

    expect(chunks).toEqual([{ index: 0, text }]);
  });

  it("splits long text into multiple chunks on paragraph boundaries, never exceeding the cap", () => {
    const paragraph = "Sentence one. Sentence two. Sentence three. ".repeat(20);
    const text = [paragraph, paragraph, paragraph].join("\n\n");

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 200,
      chunkOverlapTokens: 20,
      minChunkTokens: 5,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expectAllWithinCap(chunks, charCounter, 200);
    chunks.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
      expect(chunk.text.length).toBeGreaterThan(0);
    });
  });

  it("carries overlap text from the previous chunk into the next, within the cap", () => {
    // Each paragraph is 62 chars/tokens — well under maxChunkTokens, so there's genuine
    // headroom left for overlap after packing two paragraphs per chunk (124 <= 150).
    const paragraphs = Array.from(
      { length: 6 },
      (_, index) =>
        `Paragraph number ${index} with some extra padding text to add tokens.`,
    );
    const text = paragraphs.join("\n\n");

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 150,
      chunkOverlapTokens: 60,
      minChunkTokens: 1,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expectAllWithinCap(chunks, charCounter, 150);

    const firstChunk = chunks[0];
    const secondChunk = chunks[1];

    expect(firstChunk).toBeDefined();
    expect(secondChunk).toBeDefined();

    const firstChunkLastParagraph = firstChunk?.text.split("\n\n").pop();

    expect(
      firstChunkLastParagraph
        ? secondChunk?.text.includes(firstChunkLastParagraph)
        : false,
    ).toBe(true);
  });

  // Regression test for a real bug (found in review): when a single unit carried forward as
  // overlap is already close to chunkOverlapTokens on its own, the old code still added the
  // next unit unconditionally, producing a chunk far over maxChunkTokens. Reproduced exactly:
  // two 95-token paragraphs, maxChunkTokens=100, chunkOverlapTokens=90 used to yield a second
  // chunk of ~190 tokens (almost 2x the cap).
  it("never lets overlap + the next unit exceed maxChunkTokens, even when a single unit is nearly as big as the overlap target", () => {
    const paragraphA = "a".repeat(95);
    const paragraphB = "b".repeat(95);
    const text = [paragraphA, paragraphB].join("\n\n");

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 100,
      chunkOverlapTokens: 90,
      minChunkTokens: 1,
    });

    expectAllWithinCap(chunks, charCounter, 100);
  });

  // Regression test for a real bug (found by mentors fuzz testing after the first two overlap/
  // merge bugs were fixed): the overlap ceiling used to be a proxy (`maxChunkTokens -
  // unit.tokens`) that assumed joining the overlap to the upcoming unit costs nothing extra —
  // but joinUnits inserts a "\n\n" separator there too. With 3 paragraphs (7, 6, 5 "tokens"),
  // maxChunkTokens=20, chunkOverlapTokens=12: the first chunk packs the first two paragraphs
  // (7 + 2-token separator + 6 = 15 <= 20). Adding the third paragraph overflows (15 + 2 + 5 =
  // 22 > 20), so the chunk closes and the old proxy-based takeOverlapSuffix carried BOTH prior
  // paragraphs forward as overlap (proxy ceiling: 20 - 5 = 15, and 15 <= 15 looked fine) —
  // producing a second chunk of all 3 paragraphs joined (7+2+6+2+5 = 22 tokens), over the cap.
  // The fix re-checks the real joined text (overlap + upcoming unit) at every candidate step,
  // so only the second paragraph is carried forward here, keeping every chunk within the cap.
  it("never lets a multi-unit overlap plus the next unit exceed maxChunkTokens, across 3+ paragraphs", () => {
    const paragraphs = ["Q".repeat(7), "R".repeat(6), "S".repeat(5)];
    const text = paragraphs.join("\n\n");

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 20,
      chunkOverlapTokens: 12,
      minChunkTokens: 1,
    });

    expectAllWithinCap(chunks, charCounter, 20);
  });

  it("falls back to sentence splitting when a single paragraph exceeds maxChunkTokens", () => {
    const text = "Sentence. ".repeat(30).trim();

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 40,
      chunkOverlapTokens: 8,
      minChunkTokens: 2,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expectAllWithinCap(chunks, charCounter, 40);
  });

  it("splits Mandarin sentences on full-width punctuation (。！？), with no space required after it", () => {
    const text =
      "修炼之路漫长而艰辛。他从未放弃过自己的信念！最终他是否能够突破瓶颈？没有人知道答案。".repeat(
        4,
      );

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 40,
      chunkOverlapTokens: 5,
      minChunkTokens: 2,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expectAllWithinCap(chunks, charCounter, 40);
    // Every chunk except possibly the last should end right at a sentence boundary — proof
    // the splitter is finding Mandarin sentence enders, not falling through to raw char-slicing.
    for (const chunk of chunks.slice(0, -1)) {
      expect(/[。！？]$/.test(chunk.text.trim())).toBe(true);
    }
  });

  it("handles mixed Latin and Mandarin text in the same field", () => {
    const text = [
      "The sect elder spoke of the ancient cultivation technique.",
      "他说：突破需要天时地利人和。Only the worthy may proceed！",
      "这是一段很长的中文描述，用来测试混合语言的分句是否正确工作。",
    ].join("\n\n");

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 60,
      chunkOverlapTokens: 10,
      minChunkTokens: 2,
    });

    expect(chunks.length).toBeGreaterThan(0);
    expectAllWithinCap(chunks, charCounter, 60);
    expect(chunks.map((c) => c.text).join("")).toContain("cultivation");
    expect(chunks.map((c) => c.text).join("")).toContain("突破");
  });

  it("falls back to a raw character-budget slice when there is no paragraph or sentence boundary at all", () => {
    const text = "a".repeat(1000);

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 100,
      chunkOverlapTokens: 0,
      minChunkTokens: 1,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expectAllWithinCap(chunks, charCounter, 100);
  });

  it("char-budget fallback respects a non-linear countTokens function (binary search, not a fixed ratio)", () => {
    const text = "a".repeat(200);

    const chunks = chunkText(text, {
      countTokens: doubleCounter,
      maxChunkTokens: 50,
      chunkOverlapTokens: 0,
      minChunkTokens: 1,
    });

    expectAllWithinCap(chunks, doubleCounter, 50);
  });

  it("absorbs a small trailing paragraph into the previous chunk during packing when it fits under the cap", () => {
    const paragraphs = [
      "Paragraph one with enough padding text to reach the token budget nicely.",
      "Paragraph two with enough padding text to reach the token budget nicely.",
      "Tiny.",
    ];
    const text = paragraphs.join("\n\n");

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 80,
      chunkOverlapTokens: 0,
      minChunkTokens: 60,
    });

    expectAllWithinCap(chunks, charCounter, 80);

    const lastChunk = chunks[chunks.length - 1];

    expect(lastChunk?.text).toContain("Tiny.");
  });

  // Regression test for a real bug (found in review): the trailing-chunk-under-minChunkTokens
  // merge used to combine it into the previous chunk unconditionally, with no check that the
  // combined size still respects maxChunkTokens. Reproduced with the review's own numbers: a
  // ~78-token previous chunk plus a small trailing chunk used to merge into an ~84-token
  // result, over an 80-token cap. Fixed: the merge is skipped (trailing chunk stays standalone)
  // whenever combining would exceed the cap — never left choosing "smaller chunk count" over
  // "respect the hard cap".
  it("does not merge a small trailing chunk into the previous one when doing so would exceed maxChunkTokens", () => {
    const previous = "p".repeat(78);
    const tiny = "Tiny";
    const text = [previous, tiny].join("\n\n");

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 80,
      chunkOverlapTokens: 0,
      minChunkTokens: 60,
    });

    expectAllWithinCap(chunks, charCounter, 80);
    expect(chunks.length).toBe(2);
    expect(chunks[1]?.text).toBe(tiny);
  });

  it("assigns sequential zero-based indexes to chunks", () => {
    const text = Array.from({ length: 5 }, (_, index) =>
      `Paragraph ${index}. `.repeat(10),
    ).join("\n\n");

    const chunks = chunkText(text, {
      countTokens: charCounter,
      maxChunkTokens: 120,
      chunkOverlapTokens: 20,
      minChunkTokens: 1,
    });

    expectAllWithinCap(chunks, charCounter, 120);
    chunks.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
    });
  });
});
