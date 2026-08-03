// 05-implementation-policy/03_qdrant_point_id_chunking.md:§12-13 — hybrid chunking for
// medium/long fields. Splitting priority: paragraph boundary, then sentence boundary, then a
// raw character-slice fallback for a single run of text with no punctuation at all.
//
// Token counting is deliberately NOT decided in this module. This project is a general-use
// narrative engine (Project.language is a free string per project, not fixed to one language),
// and a single fixed chars-per-token ratio is wrong for at least one script no matter what
// value is picked — CJK text (dense, often no whitespace between words) tokenizes very
// differently from Latin-script text. So instead of guessing, every function here that needs
// a token count takes a `countTokens` function from its caller. In production that gets wired
// to the real tokenizer already loaded inside whichever EmbeddingProvider is active (e.g. the
// local provider's @huggingface/transformers pipeline exposes one) — this module never imports
// or assumes anything about how that counting actually happens.
export type TokenCounter = (text: string) => number;

// Own resolved module URL — used by chunkerSourceHash.ts to hash whichever file is
// actually executing (this .ts file under tsx/vitest in dev, the compiled .js under
// dist/ in production). Reading it here, from chunker.ts's own import.meta.url, is
// deliberate: guessing a relative "./chunker.js" path from a DIFFERENT module doesn't
// work, because readFileSync is a raw filesystem read with no awareness of the
// .js-specifier-resolves-to-.ts-source mapping that import statements get from the
// dev loader — only chunker.ts itself always knows its own real, currently-loaded path.
export const CHUNKER_MODULE_URL = import.meta.url;

const DEFAULT_MAX_CHUNK_TOKENS = 500;
const DEFAULT_CHUNK_OVERLAP_TOKENS = 75;
const DEFAULT_MIN_CHUNK_TOKENS = 50;

export type Chunk = {
  index: number;
  text: string;
};

export type ChunkingOptions = {
  countTokens: TokenCounter;
  maxChunkTokens?: number;
  chunkOverlapTokens?: number;
  minChunkTokens?: number;
};

type Unit = {
  text: string;
  tokens: number;
};

function splitIntoParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim() !== "");
}

// `Intl.Segmenter` (built into Node/V8, no extra dependency) implements the Unicode text
// segmentation standard (UAX #29) instead of a hand-rolled punctuation regex — it already
// knows sentence-ending punctuation across scripts (Latin `. ! ?`, CJK full-width `。！？`,
// and others we haven't had to think about yet) without us maintaining a growing list per
// script. Locale "und" ("undetermined") requests the root/default Unicode rules rather than
// tailoring to one specific language — appropriate here since a single field's text isn't
// tagged with a language, and content mixes scripts freely (Project.language is a free string
// per project, not one platform-wide language).
const SENTENCE_SEGMENTER = new Intl.Segmenter("und", {
  granularity: "sentence",
});

function splitIntoSentences(text: string): string[] {
  const sentences = Array.from(SENTENCE_SEGMENTER.segment(text), (segment) =>
    segment.segment.trim(),
  ).filter((sentence) => sentence !== "");

  return sentences.length > 0 ? sentences : [text];
}

// Last-resort fallback when a single run of text has no paragraph or sentence boundary at all
// (e.g. one long unbroken sentence). Finds the largest prefix that still fits maxChunkTokens
// via binary search against the real `countTokens` — no character-ratio guess anywhere here,
// so it stays correct regardless of script.
function splitByCharBudget(
  text: string,
  maxChunkTokens: number,
  countTokens: TokenCounter,
): string[] {
  const slices: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (countTokens(remaining) <= maxChunkTokens) {
      slices.push(remaining);
      break;
    }

    let low = 1;
    let high = remaining.length;

    while (low < high) {
      const mid = Math.ceil((low + high + 1) / 2);

      if (countTokens(remaining.slice(0, mid)) <= maxChunkTokens) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    slices.push(remaining.slice(0, low));
    remaining = remaining.slice(low);
  }

  return slices;
}

// Recursively breaks text down (paragraph -> sentence -> char-slice) until every resulting
// unit individually fits within maxChunkTokens.
function toUnits(
  text: string,
  maxChunkTokens: number,
  countTokens: TokenCounter,
): Unit[] {
  const tokens = countTokens(text);

  if (tokens <= maxChunkTokens) {
    return [{ text, tokens }];
  }

  const paragraphs = splitIntoParagraphs(text);

  if (paragraphs.length > 1) {
    return paragraphs.flatMap((paragraph) =>
      toUnits(paragraph, maxChunkTokens, countTokens),
    );
  }

  const sentences = splitIntoSentences(text);

  if (sentences.length > 1) {
    return sentences.flatMap((sentence) =>
      toUnits(sentence, maxChunkTokens, countTokens),
    );
  }

  return splitByCharBudget(text, maxChunkTokens, countTokens).map((slice) => ({
    text: slice,
    tokens: countTokens(slice),
  }));
}

function joinUnits(units: Unit[]): string {
  return units.map((unit) => unit.text).join("\n\n");
}

// The overlap suffix is verified against the exact text it will actually end up next to: the
// upcoming unit that starts the new chunk. Earlier versions checked the overlap candidate's own
// token count against a ceiling of `maxChunkTokens - upcomingUnit.tokens` — a proxy that assumed
// joining the overlap to the upcoming unit costs nothing extra. It does: `joinUnits` inserts a
// "\n\n" separator between the overlap's last element and the upcoming unit, on top of whatever
// separators already sit between the overlap's own units. That proxy was still wrong (found by
// mentors fuzzing after two similar bugs were fixed elsewhere), so every candidate here is
// measured by re-joining and re-counting the REAL combined text — overlap candidate followed by
// the upcoming unit — via `countTokens(joinUnits([...candidate, upcomingUnit]))`, never a sum or
// proxy. If even the single most recent unit alone, combined with the upcoming unit, already
// exceeds maxChunkTokens, the overlap for this transition is empty (0 tokens) rather than
// overshooting the cap — the hard cap always wins over overlap continuity (§12: "split menjadi
// chunks maksimal 500 tokens" is a hard cap, not a soft target).
function takeOverlapSuffix(
  units: Unit[],
  overlapTokens: number,
  upcomingUnit: Unit,
  maxChunkTokens: number,
  countTokens: TokenCounter,
): Unit[] {
  let suffix: Unit[] = [];

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];

    if (!unit) continue;

    const candidate = [unit, ...suffix];
    const combinedWithUpcoming = countTokens(
      joinUnits([...candidate, upcomingUnit]),
    );

    if (combinedWithUpcoming > maxChunkTokens) break;

    suffix = candidate;

    if (countTokens(joinUnits(candidate)) >= overlapTokens) break;
  }

  return suffix;
}

// Field <= maxChunkTokens: always a single chunk (§13). Field > maxChunkTokens: greedily pack
// units (paragraphs, falling back to sentences, falling back to raw char slices) up to
// maxChunkTokens per chunk, carrying the trailing ~chunkOverlapTokens worth of units forward
// into the start of the next chunk for continuity. A final trailing chunk under
// minChunkTokens is merged back into the previous chunk instead of standing alone.
//
// Every "does this fit?" decision below re-joins the candidate units and calls `countTokens`
// on the actual resulting text, rather than summing cached per-unit token counts — summing
// would silently ignore the token cost of the "\n\n" separators `joinUnits` inserts between
// units, which is exactly how a chunk could end up over maxChunkTokens despite every
// individual unit (and their naive sum) looking like it fit.
export function chunkText(text: string, options: ChunkingOptions): Chunk[] {
  const { countTokens } = options;
  const maxChunkTokens = options.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS;
  const chunkOverlapTokens =
    options.chunkOverlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS;
  const minChunkTokens = options.minChunkTokens ?? DEFAULT_MIN_CHUNK_TOKENS;

  const totalTokens = countTokens(text);

  if (totalTokens <= maxChunkTokens) {
    return [{ index: 0, text }];
  }

  const units = toUnits(text, maxChunkTokens, countTokens);
  const chunks: Unit[][] = [];
  let current: Unit[] = [];

  for (const unit of units) {
    const candidate = [...current, unit];

    if (
      current.length > 0 &&
      countTokens(joinUnits(candidate)) > maxChunkTokens
    ) {
      chunks.push(current);

      const overlap = takeOverlapSuffix(
        current,
        chunkOverlapTokens,
        unit,
        maxChunkTokens,
        countTokens,
      );

      current = [...overlap, unit];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  // Merge a too-small trailing chunk into the previous one — but only if the combined size
  // still respects the hard cap. If it wouldn't, leave the small trailing chunk standing on
  // its own rather than ever producing a chunk over maxChunkTokens.
  //
  // In practice, given the greedy fill-to-capacity packing above, this merge essentially never
  // actually fires: the previous chunk was only closed because the unit that starts `last`
  // didn't fit — which means its leftover slack (maxChunkTokens - previousTokens) is always
  // SMALLER than that unit's own size (otherwise the unit would have been accepted instead of
  // rejected), and `last` is at least that unit's size. So `previousTokens + lastTokens` is
  // structurally almost always > maxChunkTokens. This isn't dead code to delete, though — it's
  // a correctness guard that stays meaningful if the packing strategy above ever changes to
  // something less strictly greedy (e.g. reserving slack ahead of a known-small remainder).
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];

    if (last) {
      const lastTokens = countTokens(joinUnits(last));

      if (lastTokens < minChunkTokens) {
        const previous = chunks[chunks.length - 2];

        if (
          previous &&
          countTokens(joinUnits([...previous, ...last])) <= maxChunkTokens
        ) {
          chunks.pop();
          previous.push(...last);
        }
      }
    }
  }

  return chunks.map((chunkUnits, index) => ({
    index,
    text: joinUnits(chunkUnits),
  }));
}
