import d3Source from "d3/dist/d3.min.js?raw";

import bootstrapSource from "./sandbox-bootstrap.js?raw";

/**
 * The sandbox iframe's Content-Security-Policy (#268, spec Key decision 1).
 * `default-src 'none'` closes every network channel (fetch/XHR/WebSocket,
 * img/font/media beacons, remote import()); only the two inline scripts
 * (D3 + bootstrap) and inline styles may run. Combined with
 * `sandbox="allow-scripts"` (opaque origin — no cookies, storage, or
 * app-origin reach), this is the containment for agent-authored programs.
 */
export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

/**
 * `</script>` inside an embedded source would terminate the inline
 * <script> element early. `<\/script>` is byte-identical inside JS string
 * literals and cannot appear outside them in valid JS, so the escape is
 * behavior-preserving.
 */
const escapeInlineScript = (source: string): string =>
  source.replace(/<\/script/gi, "<\\/script");

/**
 * Pure composer — sources are injectable so tests assert against fixtures
 * (the `?raw` imports are stubbed under jest).
 */
export function buildSandboxSrcdoc(parts: {
  d3Source: string;
  bootstrapSource: string;
}): string {
  return [
    "<!doctype html>",
    "<html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
    "<style>html,body{margin:0;padding:0}#root{width:100%}</style>",
    "</head><body>",
    '<div id="root"></div>',
    `<script>${escapeInlineScript(parts.d3Source)}</script>`,
    `<script>${escapeInlineScript(parts.bootstrapSource)}</script>`,
    "</body></html>",
  ].join("");
}

/**
 * Built once per app load and shared by every widget instance — the
 * srcdoc is static; per-widget program/data/theme arrive over the
 * postMessage bridge (spec Decision 5).
 */
export const SANDBOX_SRCDOC = buildSandboxSrcdoc({
  d3Source,
  bootstrapSource,
});
