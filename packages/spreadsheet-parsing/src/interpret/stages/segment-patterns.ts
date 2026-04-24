/**
 * Generic pattern bank for heuristic segment detection. Classifies a trimmed
 * header label into one of six tags and exposes the pattern's axis-name hint
 * and "dynamic" flag (open-ended label set → segment can claim a dynamic
 * tail). Kept intentionally generic — no schema-specific name guessing, no
 * field-value sampling. LLM refinement happens downstream.
 */

export type LabelTag = "quarter" | "month" | "year" | "date" | "skip" | "field";

interface Pattern {
  tag: LabelTag;
  regex: RegExp;
  axisName: string;
  dynamic: boolean;
}

const PATTERNS: ReadonlyArray<Pattern> = [
  {
    tag: "quarter",
    regex: /^(FY\d{2})?Q[1-4]$/i,
    axisName: "quarter",
    dynamic: false,
  },
  {
    tag: "month",
    regex:
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)$/i,
    axisName: "month",
    dynamic: false,
  },
  {
    tag: "year",
    regex: /^(20\d{2}|FY\d{2})$/,
    axisName: "year",
    dynamic: true,
  },
  {
    tag: "date",
    regex: /^\d{4}-\d{2}-\d{2}$/,
    axisName: "date",
    dynamic: true,
  },
  {
    tag: "skip",
    regex: /^total$/i,
    axisName: "",
    dynamic: false,
  },
];

export function classifyLabel(label: string): LabelTag {
  const needle = label.trim();
  if (needle === "") return "field";
  for (const p of PATTERNS) {
    if (p.regex.test(needle)) return p.tag;
  }
  return "field";
}

/**
 * Axis-name hint attached to a pivot segment produced from this tag. Returns
 * `null` for `"field"` (no pattern); returns the pattern's `axisName` for
 * every other tag — including the empty string for `"skip"`, which has no
 * axis name by design.
 */
export function axisNameFor(tag: LabelTag): string | null {
  const pattern = PATTERNS.find((p) => p.tag === tag);
  return pattern ? pattern.axisName : null;
}

/**
 * Whether a segment produced from this tag may claim an open-ended dynamic
 * tail. Quarter and month are fixed enums; year and ISO date are open-ended.
 */
export function dynamicForTag(tag: LabelTag): boolean {
  return PATTERNS.find((p) => p.tag === tag)?.dynamic ?? false;
}
