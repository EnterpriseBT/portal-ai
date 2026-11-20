import { searchHelp, type HelpSurface } from "@portalai/core/content";

/**
 * Help page search order (#1049): the entries help search ranks for `query`,
 * in its order (the same ranker the assistant's help tool uses), followed by
 * any other entries a substring search matched, so nothing the page listed
 * before help search is lost. With no ranked match (no query, or a word
 * still being typed) it's the substring matches alone.
 */
export function orderBySearch<T extends object>(
  entries: readonly T[],
  slugOf: (entry: T) => string,
  surface: HelpSurface,
  query: string,
  category: string | undefined,
  substringMatches: readonly T[]
): T[] {
  const matches = searchHelp(query, { surfaces: [surface], category });
  if (matches.length === 0) return [...substringMatches];
  const bySlug = new Map(entries.map((e) => [slugOf(e), e]));
  const ranked = matches.flatMap((m) => bySlug.get(m.doc.slug) ?? []);
  const seen = new Set(ranked);
  return [...ranked, ...substringMatches.filter((e) => !seen.has(e))];
}
