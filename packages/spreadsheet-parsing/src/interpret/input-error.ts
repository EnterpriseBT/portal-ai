/**
 * The parser's input error (#1002, #1008): what the caller must change, one
 * sentence per problem, with the `UNSUPPORTED_LAYOUT_SHAPE` prefix the API
 * answers as a 400 carrying this message.
 *
 * Capped, so the response and its log line can't scale with the request
 * body (CLAUDE.md's #745 rule): the first problems in hint order, then a
 * count of the rest.
 */
export const MAX_REPORTED_PROBLEMS = 20;

export function inputError(problems: string[]): Error {
  const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
  const hidden = problems.length - shown.length;
  const more = hidden > 0 ? ` And ${hidden} more not shown.` : "";
  return new Error(`UNSUPPORTED_LAYOUT_SHAPE: ${shown.join(" ")}${more}`);
}
