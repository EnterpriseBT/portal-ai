const formatCount = (n: number) => n.toLocaleString("en-US");

/**
 * The note a chart's or map's data table shows when its staged result was cut
 * short at the row cap (#796). `staged` is the snapshot's total. A known
 * matched count is named, as "at least" when it's a lower bound; without one
 * the note can only say "more than" the staged rows.
 */
export function dataCapNote(
  staged: number,
  source: {
    truncated?: boolean;
    matchedCount?: number;
    matchedCountExact?: boolean;
  }
): string | undefined {
  if (!source.truncated || staged <= 0) return undefined;
  const first = `Showing the first ${formatCount(staged)}`;
  if (source.matchedCount != null && source.matchedCount > staged) {
    return source.matchedCountExact
      ? `${first} of ${formatCount(source.matchedCount)} rows.`
      : `${first} of at least ${formatCount(source.matchedCount)} rows.`;
  }
  return `${first} of more than ${formatCount(staged)} rows.`;
}
