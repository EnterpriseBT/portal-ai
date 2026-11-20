/**
 * Help search (#1049): one ranker over the shipped help content, shared by the
 * in-session `platform_help` tool and the Help page's search box, so a query
 * finds the same entries in the same order in both.
 *
 * BM25 over field-weighted tokens. The title (a FAQ question, glossary term
 * or troubleshooting symptom) and its `aliases` count three times the body,
 * so an entry is found by what it's about rather than by a word it happens to
 * mention. Aliases are how the content adapts to how people actually ask
 * ("spreadsheet" finds the entry about connecting a data source): adding one
 * is a content edit, and the findability tests prove it works.
 *
 * Pure and deterministic. It imports only its sibling content modules (the
 * content purity rule allows nothing else), so the marketing site and the API
 * can load it with no runtime dependencies.
 */

import { FAQ_ENTRIES } from "./faq.util.js";
import { GLOSSARY_ENTRIES, contentEntrySlug } from "./glossary.util.js";
import { HELP_TAB, buildHelpUrl } from "./help-url.util.js";
import { TROUBLESHOOTING_ENTRIES } from "./troubleshooting.util.js";

export type HelpSurface = "faq" | "glossary" | "troubleshooting";

/** One searchable help entry, whichever surface it comes from. */
export interface HelpDocument {
  surface: HelpSurface;
  /** `contentEntrySlug(title)`, the Help anchor's slug. */
  slug: string;
  /** A FAQ question, glossary term or troubleshooting symptom. */
  title: string;
  /** The text a reader sees under the title, verbatim. */
  body: string;
  /** Phrasings the title doesn't contain, weighted like the title. */
  aliases: readonly string[];
  /** Related terms or titles, weighted like the body. */
  related: readonly string[];
  /** A FAQ or glossary category; troubleshooting has none. */
  category?: string;
}

export interface HelpMatch {
  doc: HelpDocument;
  score: number;
}

/** BM25 constants and per-field weights. */
export const HELP_RANKING = {
  k1: 1.2,
  b: 0.75,
  weights: { title: 3, aliases: 3, body: 1, related: 1 },
  /**
   * Added when the query is the entry's title, give or take case and
   * punctuation. Stopwords make "Tool Pack" and "What are tool packs?" the
   * same terms; this is what tells the glossary term from the FAQ question.
   */
  exactTitleBonus: 10,
} as const;

/**
 * The lowest score at which a match on body words alone counts. An entry a
 * query names in its title or an alias always counts; one it only brushes in
 * the body ("scores" in a glossary example) needs this much evidence. Tuned
 * against the paraphrase and nonsense fixtures
 * (`__tests__/content/fixtures/help-paraphrases.ts`).
 */
export const HELP_MATCH_FLOOR = 3;

/** Words that carry no topic. Kept short on purpose: every word here is one
 *  that can never be searched for. Particles and negation that change a
 *  phrase's meaning ("set up", "sign out", "no records") stay searchable. */
export const HELP_STOPWORDS: ReadonlySet<string> = new Set(
  (
    "a an the and or but of to in on at for with by from into about as " +
    "is are was were be been being am it its this that these those there here " +
    "i me my mine we our us you your he she they them their " +
    "how what which who whom why when where " +
    "do does did doing done can could should would will shall may might must " +
    "have has had having get got not yes so if then than too very just also " +
    "any some all each more most other such only own same again " +
    "s t ve ll re d m don doesn didn isn aren wasn weren won can t"
  ).split(" ")
);

/** Light suffix stemming, so "stations", "importing" and "synced" meet their
 *  base word. A final silent "e" is dropped too, so "create", "created" and
 *  "creating" all meet at "creat". Never shortens a word below three letters. */
function stem(word: string): string {
  const cut = (w: string, n: number, add = "") => {
    const base = w.slice(0, -n) + add;
    return base.length >= 3 ? base : w;
  };
  let w = word;
  if (w.endsWith("ies") && w.length > 4) w = cut(w, 3, "y");
  else if (w.endsWith("sses")) w = cut(w, 2);
  else if (/(xes|ches|shes|zes)$/.test(w)) w = cut(w, 2);
  else if (w.endsWith("ing") && w.length > 5) w = cut(w, 3);
  else if (w.endsWith("ed") && w.length > 4) w = cut(w, 2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = cut(w, 1);
  if (w.endsWith("e") && !w.endsWith("ee") && w.length > 3) w = cut(w, 1);
  return w;
}

/** The ranker's tokens for a piece of text: accents stripped, lowercase,
 *  split on anything that isn't a letter or digit (in any script),
 *  stopwords dropped, stemmed. */
export function tokenizeHelp(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0 && !HELP_STOPWORDS.has(w))
    .map(stem);
}

const faqDocuments = (): HelpDocument[] =>
  FAQ_ENTRIES.map((e) => ({
    surface: "faq",
    slug: contentEntrySlug(e.question),
    title: e.question,
    body: e.answer,
    aliases: e.aliases ?? [],
    related: e.relatedGlossaryTerms ?? [],
    category: e.category,
  }));

const glossaryDocuments = (): HelpDocument[] =>
  GLOSSARY_ENTRIES.map((e) => ({
    surface: "glossary",
    slug: contentEntrySlug(e.term),
    title: e.term,
    body: e.definition,
    aliases: e.aliases ?? [],
    related: e.relatedTerms ?? [],
    category: e.category,
  }));

/** A troubleshooting entry's body: its cause and fix under fixed labels, so
 *  the text a reader sees is the entry's own words and nothing else. */
export const troubleshootingBody = (e: {
  cause: string;
  fix: string;
}): string => `Why it happens: ${e.cause}\nWhat to do: ${e.fix}`;

const troubleshootingDocuments = (): HelpDocument[] =>
  TROUBLESHOOTING_ENTRIES.map((e) => ({
    surface: "troubleshooting",
    slug: contentEntrySlug(e.symptom),
    title: e.symptom,
    body: troubleshootingBody(e),
    aliases: e.aliases ?? [],
    related: (e.related ?? []).map((r) => r.title),
  }));

/** Every help entry, in surface order: FAQ, glossary, troubleshooting. */
export const HELP_CORPUS: readonly HelpDocument[] = [
  ...faqDocuments(),
  ...glossaryDocuments(),
  ...troubleshootingDocuments(),
];

/** The document an entry id (`<surface>:<slug>`) names, if it exists. */
export function findHelpDocument(
  surface: HelpSurface,
  slug: string
): HelpDocument | undefined {
  return HELP_CORPUS.find((d) => d.surface === surface && d.slug === slug);
}

const SURFACE_TAB = {
  faq: HELP_TAB.faq,
  glossary: HELP_TAB.glossary,
  troubleshooting: HELP_TAB.troubleshooting,
} as const;

/** The Help page address of a document: its tab, scrolled to the entry. */
export function helpDocumentUrl(
  doc: Pick<HelpDocument, "surface" | "slug">
): string {
  return buildHelpUrl({
    tab: SURFACE_TAB[doc.surface],
    entry: { surface: doc.surface, slug: doc.slug },
  });
}

interface Indexed {
  doc: HelpDocument;
  /** Weighted term frequency. */
  tf: Map<string, number>;
  /** Weighted document length. */
  length: number;
  /** The title's distinct tokens, for the whole-title bonus. */
  titleTokens: Set<string>;
  /** Title and alias tokens: a hit here is a match whatever the score. */
  headTokens: Set<string>;
  /** BM25's length normalisation, `k1 (1 - b + b·len/avg)`. Fixed per
   *  document, so computed once when the index is built. */
  norm: number;
}

function indexDocument(doc: HelpDocument): Indexed {
  const { weights } = HELP_RANKING;
  const tf = new Map<string, number>();
  let length = 0;
  const add = (text: string, weight: number) => {
    for (const token of tokenizeHelp(text)) {
      tf.set(token, (tf.get(token) ?? 0) + weight);
      length += weight;
    }
  };
  add(doc.title, weights.title);
  for (const alias of doc.aliases) add(alias, weights.aliases);
  add(doc.body, weights.body);
  for (const related of doc.related) add(related, weights.related);
  return {
    doc,
    tf,
    length,
    titleTokens: new Set(tokenizeHelp(doc.title)),
    headTokens: new Set([
      ...tokenizeHelp(doc.title),
      ...doc.aliases.flatMap(tokenizeHelp),
    ]),
    norm: 0,
  };
}

interface Index {
  docs: Indexed[];
  avgLength: number;
  idf: (token: string) => number;
}

function buildIndex(corpus: readonly HelpDocument[]): Index {
  const docs = corpus.map(indexDocument);
  const avgLength =
    docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1);
  const { k1, b } = HELP_RANKING;
  for (const d of docs) {
    d.norm = k1 * (1 - b + (b * d.length) / Math.max(avgLength, 1));
  }
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const token of d.tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = (token: string) => {
    const f = df.get(token) ?? 0;
    return Math.log(1 + (n - f + 0.5) / (f + 0.5));
  };
  return { docs, avgLength, idf };
}

let defaultIndex: Index | undefined;
const indexFor = (corpus: readonly HelpDocument[]): Index => {
  if (corpus !== HELP_CORPUS) return buildIndex(corpus);
  defaultIndex ??= buildIndex(HELP_CORPUS);
  return defaultIndex;
};

const SURFACE_ORDER: Record<HelpSurface, number> = {
  faq: 0,
  glossary: 1,
  troubleshooting: 2,
};

/**
 * Rank help entries for a question, best first. An entry counts as a match
 * when a query term hits its title or an alias, or when its score reaches
 * `floor` on body words alone.
 *
 * The question's tokens and each keyword's tokens form one set of query
 * terms. Each entry scores by BM25 over its weighted fields, plus the summed
 * IDF of its title's terms when every one of them is in the query, so an
 * entry asked for by its own title or term comes first. Matches below
 * `HELP_MATCH_FLOOR` are dropped. Ties break by surface (FAQ, glossary,
 * troubleshooting) and then title, so the order never depends on the
 * corpus's array order.
 *
 * `floor` overrides `HELP_MATCH_FLOOR`: scores scale with the corpus, so a
 * caller ranking its own small corpus (a test) sets its own.
 */
export function searchHelp(
  query: string,
  opts: {
    keywords?: readonly string[];
    surfaces?: readonly HelpSurface[];
    category?: string;
    limit?: number;
    corpus?: readonly HelpDocument[];
    floor?: number;
  } = {}
): HelpMatch[] {
  const terms = new Set([
    ...tokenizeHelp(query),
    ...(opts.keywords ?? []).flatMap(tokenizeHelp),
  ]);
  if (terms.size === 0) return [];

  const { k1, exactTitleBonus } = HELP_RANKING;
  const floor = opts.floor ?? HELP_MATCH_FLOOR;
  const querySlug = contentEntrySlug(query);
  const index = indexFor(opts.corpus ?? HELP_CORPUS);
  const matches: HelpMatch[] = [];
  for (const d of index.docs) {
    if (opts.surfaces && !opts.surfaces.includes(d.doc.surface)) continue;
    if (opts.category && d.doc.category !== opts.category) continue;

    let score = 0;
    for (const term of terms) {
      const f = d.tf.get(term);
      if (!f) continue;
      score += index.idf(term) * ((f * (k1 + 1)) / (f + d.norm));
    }
    if (
      score > 0 &&
      d.titleTokens.size > 0 &&
      [...d.titleTokens].every((t) => terms.has(t))
    ) {
      for (const t of d.titleTokens) score += index.idf(t);
    }
    if (score > 0 && querySlug === d.doc.slug) score += exactTitleBonus;
    const namesIt = [...terms].some((t) => d.headTokens.has(t));
    if (score > 0 && (namesIt || score >= floor)) {
      matches.push({ doc: d.doc, score });
    }
  }

  matches.sort(
    (a, c) =>
      c.score - a.score ||
      SURFACE_ORDER[a.doc.surface] - SURFACE_ORDER[c.doc.surface] ||
      (a.doc.title < c.doc.title ? -1 : a.doc.title > c.doc.title ? 1 : 0)
  );
  return opts.limit === undefined ? matches : matches.slice(0, opts.limit);
}
