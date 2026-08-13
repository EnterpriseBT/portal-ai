/**
 * Addressable Help URLs (#365 grammar, built here since #367).
 *
 * `/help` accepts `?tab=` + `?category=` and an optional
 * `#<surface>-entry-<slug>` fragment. The **reader** of that grammar lives in
 * the web app (`normalizeHelpSearch` / `parseHelpAnchor` in
 * `apps/web/src/utils/routes.util.ts`); this is the **writer**.
 *
 * It lives here rather than in the web app because `apps/api` needs it too —
 * the in-session help tool cites Help destinations and cannot import
 * `apps/web`. A URL grammar with two independent hardcoded copies is a
 * grammar that drifts, so the writer sits beside `contentEntrySlug`, which
 * produces the slugs the fragment is built from.
 *
 * Like everything in this module, it imports nothing.
 */

/** The tab slugs `/help?tab=` accepts. Mirrors the web app's `HelpTab`. */
export const HELP_TAB = {
  gettingStarted: "getting-started",
  glossary: "glossary",
  faq: "faq",
} as const;

export type HelpTabSlug = (typeof HELP_TAB)[keyof typeof HELP_TAB];

/** The two tabs whose individual entries are addressable by fragment. */
export type HelpEntrySurface = "glossary" | "faq";

export interface HelpUrlOptions {
  tab?: HelpTabSlug;
  /**
   * A `GlossaryCategory` or `FAQCategory` value. Only meaningful relative to
   * a tab — an orphan category is dropped, because the reader drops it too.
   */
  category?: string;
  /** Scrolls to and expands one entry. Slug comes from `contentEntrySlug`. */
  entry?: { surface: HelpEntrySurface; slug: string };
}

/**
 * Build an addressable Help URL.
 *
 * @example buildHelpUrl({ tab: HELP_TAB.faq, category: "analytics" })
 *          // "/help?tab=faq&category=analytics"
 */
export function buildHelpUrl(options: HelpUrlOptions): string {
  const { tab, category, entry } = options;

  const params: string[] = [];
  if (tab) {
    params.push(`tab=${tab}`);
    // A category without a tab resolves to nothing on arrival, so it is
    // dropped here rather than emitted and silently discarded.
    if (category) params.push(`category=${category}`);
  }

  const query = params.length > 0 ? `?${params.join("&")}` : "";
  // The fragment always follows the query — `#frag?query` is not a URL.
  const hash = entry ? `#${entry.surface}-entry-${entry.slug}` : "";

  return `/help${query}${hash}`;
}
