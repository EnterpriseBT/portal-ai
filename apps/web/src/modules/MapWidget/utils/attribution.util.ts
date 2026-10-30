/**
 * Safe map attribution (#928).
 *
 * MapLibre renders every source's `attribution` as HTML through a deny-list
 * sanitizer (`DOM.sanitize`), which removes `<script>`, `<iframe>`, `on*`
 * handlers and `javascript:`/`data:` URLs but keeps `<style>`, `<link>`,
 * `<form>`, `<img>` and any `https:` link. A map spec's basemap can be a style
 * URL the portal author chose, so that let them put page-wide CSS or a
 * phishing form into the app. The widget therefore renders attribution itself
 * from these parts: text, plus links only to the hosts that legitimately
 * credit our basemaps.
 */

/**
 * The exact hosts an attribution may link to, over https only. Exact, not
 * suffix: CARTO serves user accounts on `<account>.carto.com`, so a subdomain
 * match would let a hostile style link to an attacker's page.
 */
export const ATTRIBUTION_LINK_HOSTS = [
  "openstreetmap.org",
  "www.openstreetmap.org",
  "carto.com",
  "www.carto.com",
];

/** One run of attribution text, optionally a link. */
export interface AttributionPart {
  text: string;
  href?: string;
}

export interface SafeAttributionOptions {
  /**
   * Keep an https link to any host. Only for an operator's own (`custom`)
   * basemap, where the install ignores the spec's style URL, so every source
   * is one the operator chose; their providers' credits may require links.
   */
  anyHttpsLink?: boolean;
}

// Elements whose content is not attribution text (CSS, scripts, form fields,
// media): dropped whole, text included.
const DROPPED = new Set([
  "style",
  "script",
  "noscript",
  "template",
  "title",
  "link",
  "meta",
  "img",
  "picture",
  "video",
  "audio",
  "iframe",
  "object",
  "embed",
  "input",
  "select",
  "textarea",
]);

const allowedHref = (
  href: string | null,
  { anyHttpsLink = false }: SafeAttributionOptions
): string | undefined => {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase();
    return anyHttpsLink || ATTRIBUTION_LINK_HOSTS.includes(host)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Visit the text under a node, skipping dropped elements. `onLink` receives an
 * allowed link with its text; without it (inside a link), links are text.
 */
const visit = (
  node: Node,
  onText: (text: string) => void,
  onLink: ((text: string, href: string) => void) | null,
  options: SafeAttributionOptions
): void => {
  if (node.nodeType === Node.TEXT_NODE) {
    onText(node.nodeValue ?? "");
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (DROPPED.has(el.localName)) return;
  if (el.localName === "a" && onLink) {
    let text = "";
    el.childNodes.forEach((child) =>
      visit(child, (t) => (text += t), null, options)
    );
    const href = allowedHref(el.getAttribute("href"), options);
    if (href && text.trim()) onLink(text, href);
    else onText(text);
    return;
  }
  el.childNodes.forEach((child) => visit(child, onText, onLink, options));
};

/** Merge adjacent text parts and collapse whitespace across part boundaries. */
const normalize = (parts: AttributionPart[]): AttributionPart[] => {
  const out: AttributionPart[] = [];
  let endsInSpace = true; // drops leading whitespace
  for (const part of parts) {
    let text = part.text.replace(/\s+/g, " ");
    if (endsInSpace) text = text.replace(/^ /, "");
    if (!text) continue;
    endsInSpace = text.endsWith(" ");
    const last = out[out.length - 1];
    if (part.href === undefined && last && last.href === undefined) {
      last.text += text;
    } else {
      out.push(part.href === undefined ? { text } : { text, href: part.href });
    }
  }
  return out;
};

/**
 * Convert one attribution string to safe parts. `DOMParser` builds an inert
 * document (no script runs, nothing loads), and only text and allowed links
 * come out of it, so whatever markup the string carries never reaches the
 * page.
 */
export function toSafeAttribution(
  html: string,
  options: SafeAttributionOptions = {}
): AttributionPart[] {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const parts: AttributionPart[] = [];
  body?.childNodes.forEach((child) =>
    visit(
      child,
      (text) => parts.push({ text }),
      (text, href) => parts.push({ text, href }),
      options
    )
  );
  return normalize(parts);
}

const plainText = (parts: AttributionPart[]) =>
  parts
    .map((p) => p.text)
    .join("")
    .trim();

/**
 * The attributions worth showing, sanitized: non-empty, and, comparing the
 * sanitized text (so markup can't make duplicates look distinct), without any
 * entry another one already contains, as MapLibre's own control picks them.
 */
export function toSafeAttributions(
  strings: (string | undefined)[],
  options: SafeAttributionOptions = {}
): AttributionPart[][] {
  const unique: { parts: AttributionPart[]; text: string }[] = [];
  for (const s of strings) {
    if (!s) continue;
    const parts = toSafeAttribution(s, options);
    const text = plainText(parts);
    if (text && !unique.some((u) => u.text === text)) {
      unique.push({ parts, text });
    }
  }
  return unique
    .filter((a) => !unique.some((b) => b !== a && b.text.includes(a.text)))
    .map((u) => u.parts);
}
