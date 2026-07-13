/**
 * Pure prompt-construction layer for the REST API connector's
 * JSONata transform suggester.
 *
 * Two exports, both side-effect-free:
 *
 *   - `truncateForPrompt(value)` walks a JSON-shaped value and slices
 *     every array to its first 5 elements, appending the literal
 *     string `"__truncated__"` as a 6th element when the slice
 *     actually happens. Objects are recursed; primitives pass
 *     through. Keeps prompt size bounded for arbitrarily large
 *     responses without losing structural information about the
 *     shape (the only thing the model needs to write a JSONata
 *     expression).
 *
 *   - `buildJsonataSuggestPrompt(input)` composes a deterministic
 *     string prompt from a (pre-truncated) sample, an optional
 *     natural-language hint, and an optional previous-attempt record
 *     used during the route's one-shot retry path. Mirrors the
 *     column classifier's prompt-builder style (`classifier.prompt.ts`):
 *     heading lines + per-section content + a closing instruction.
 */

/** Number of array elements to keep before appending the truncation sentinel. */
const ARRAY_KEEP = 5;

/** Sentinel value that replaces the dropped tail of a truncated array. */
const TRUNCATED_SENTINEL = "__truncated__";

/**
 * Recursive tree walker. Slices arrays to at most ARRAY_KEEP elements
 * (recursing into each surviving element first), passes objects
 * through with each value recursed, and returns primitives as-is.
 *
 * The function does not deep-clone unless it has to — primitives are
 * returned identically, but composite values (arrays + objects) are
 * always new instances so callers can mutate without aliasing the
 * input.
 */
export function truncateForPrompt(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const kept = value.slice(0, ARRAY_KEEP).map(truncateForPrompt);
    if (value.length > ARRAY_KEEP) kept.push(TRUNCATED_SENTINEL);
    return kept;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = truncateForPrompt((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Input to `buildJsonataSuggestPrompt`. */
export interface BuildJsonataSuggestPromptInput {
  /** The sample response, already passed through `truncateForPrompt`. */
  sampleResponse: unknown;
  /** Optional natural-language hint from the user. */
  promptHint?: string;
  /**
   * Set when the route is retrying after the first attempt failed
   * server-side validation against the (untruncated) sample. The
   * model gets the prior expression + the validation error message
   * so it can correct course.
   */
  previousAttempt?: { expression: string; error: string };
}

/**
 * Deterministic prompt composer. Same input always produces the same
 * string. No randomness, no I/O. Sections render in a fixed order;
 * the "Previous attempt" section is omitted entirely when unset (no
 * empty header).
 */
export function buildJsonataSuggestPrompt(
  input: BuildJsonataSuggestPromptInput
): string {
  const { sampleResponse, promptHint, previousAttempt } = input;

  const lines: string[] = [
    "You are writing a JSONata expression that transforms a JSON HTTP response",
    "into an array of flat record objects. The expression must:",
    "- Return an array (each element a plain object, never a primitive).",
    "- Project nested fields into top-level keys so downstream inference can",
    '  enumerate them — e.g. `data.{ "id": id, "user_name": user.name }`.',
    "- Reference docs.jsonata.org syntax only. No JavaScript, no I/O.",
    "",
    "## Sample response",
    JSON.stringify(sampleResponse, null, 2),
    "",
    "## User hint",
    promptHint && promptHint.length > 0 ? promptHint : "(no hint provided)",
  ];

  if (previousAttempt) {
    lines.push(
      "",
      "## Previous attempt",
      "The previous attempt produced an expression that failed validation.",
      "Use the error message below to correct course.",
      "",
      `Expression: ${previousAttempt.expression}`,
      `Error: ${previousAttempt.error}`
    );
  }

  lines.push(
    "",
    'Return JSON: { "expression": "<jsonata expression string>" }.',
    "Emit exactly one expression. No commentary, no alternatives, no markdown."
  );

  return lines.join("\n");
}
