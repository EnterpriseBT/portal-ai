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

/** Hosts an attribution may link to (and their subdomains), over https only. */
export const ATTRIBUTION_LINK_HOSTS = ["openstreetmap.org", "carto.com"];

/** One run of attribution text, optionally a link to an allow-listed host. */
export interface AttributionPart {
  text: string;
  href?: string;
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

const allowedHref = (href: string | null): string | undefined => {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    const allowed = ATTRIBUTION_LINK_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`)
    );
    return url.protocol === "https:" && allowed ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const collapse = (s: string) => s.replace(/\s+/g, " ");

/** The visible text under a node, skipping dropped elements. */
const textOf = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return collapse(node.nodeValue ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  if (DROPPED.has((node as Element).localName)) return "";
  return Array.from(node.childNodes).map(textOf).join("");
};

/**
 * Convert one attribution string to safe parts. `DOMParser` builds an inert
 * document (no script runs, nothing loads), and only text and allow-listed
 * links come out of it, so whatever markup the string carries never reaches
 * the page.
 */
export function toSafeAttribution(html: string): AttributionPart[] {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const parts: AttributionPart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.href === undefined) last.text += text;
    else parts.push({ text });
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(collapse(node.nodeValue ?? ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (DROPPED.has(el.localName)) return;
    if (el.localName === "a") {
      const href = allowedHref(el.getAttribute("href"));
      const text = textOf(el);
      if (href && text.trim()) parts.push({ text, href });
      else pushText(text);
      return;
    }
    el.childNodes.forEach(walk);
  };

  body?.childNodes.forEach(walk);
  return parts;
}

/**
 * The attribution strings worth showing, as MapLibre's own control picks them:
 * non-empty, deduplicated, and without any entry another one already contains.
 */
export function mergeAttributions(strings: (string | undefined)[]): string[] {
  const unique: string[] = [];
  for (const s of strings) {
    if (s && s.trim() && !unique.includes(s)) unique.push(s);
  }
  return unique.filter((a) => !unique.some((b) => b !== a && b.includes(a)));
}
