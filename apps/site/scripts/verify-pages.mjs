/**
 * Post-build self-check (#311) — the site's real test suite.
 *
 * Astro components have no useful unit-test surface: their contract IS the
 * emitted HTML, and a jest test that mocked the renderer would assert
 * nothing worth knowing. So the assertions live here, run against the actual
 * `dist/` output, and are wired into `npm run build` — an SEO regression is
 * a failed build, not a thing someone notices in Search Console six weeks
 * later.
 *
 * What it pins, and why each one is a real failure mode:
 *
 * - unique, non-empty `<title>` per page — duplicates get pages collapsed
 *   in search results;
 * - a self-referencing canonical matching the page's own route — a wrong
 *   canonical hands your ranking to another URL;
 * - exactly one `<h1>`;
 * - a meta description;
 * - parseable JSON-LD — a malformed block is silently ignored by crawlers,
 *   so nothing tells you it broke;
 * - every emitted route present in the sitemap;
 * - the pricing page actually shows a figure or a contact card per tier —
 *   catches a snapshot that parsed but rendered empty;
 * - no fixture stamp when the build had a live config URL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const failures = [];
const fail = (message) => failures.push(message);

if (!fs.existsSync(dist)) {
  console.error("verify-pages — dist/ does not exist; run the build first");
  process.exit(1);
}

/** Every emitted page, as `{ route, html }`. */
function collectPages(dir = dist, route = "/") {
  const pages = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_astro") continue;
      pages.push(...collectPages(full, `${route}${entry.name}/`));
    } else if (entry.name === "index.html") {
      pages.push({ route, html: fs.readFileSync(full, "utf8"), file: full });
    } else if (entry.name.endsWith(".html")) {
      // e.g. 404.html — emitted flat, not as a directory index.
      pages.push({
        route: `${route}${entry.name}`,
        html: fs.readFileSync(full, "utf8"),
        file: full,
      });
    }
  }
  return pages;
}

const pages = collectPages();

if (pages.length === 0) fail("no pages were emitted");

const titles = new Map();

for (const page of pages) {
  const { route, html } = page;

  // ── title ──────────────────────────────────────────────────────────
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
  if (!title) {
    fail(`${route}: missing <title>`);
  } else if (titles.has(title)) {
    fail(`${route}: duplicate <title> "${title}" (also ${titles.get(title)})`);
  } else {
    titles.set(title, route);
  }

  // ── meta description ───────────────────────────────────────────────
  const description = html.match(
    /<meta\s+name="description"\s+content="([^"]*)"/
  )?.[1];
  if (!description || description.trim().length < 40) {
    fail(`${route}: missing or too-short meta description`);
  }

  // ── canonical, self-referencing ────────────────────────────────────
  const canonical = html.match(
    /<link\s+rel="canonical"\s+href="([^"]*)"/
  )?.[1];
  if (!canonical) {
    fail(`${route}: missing canonical link`);
  } else {
    const canonicalPath = new URL(canonical).pathname;
    // 404.html is emitted flat but declares the /404/ route.
    const expected = route.endsWith(".html")
      ? `/${path.basename(route, ".html")}/`
      : route;
    if (canonicalPath !== expected) {
      fail(
        `${route}: canonical points at ${canonicalPath}, expected ${expected}`
      );
    }
  }

  // ── exactly one h1 ─────────────────────────────────────────────────
  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) fail(`${route}: expected exactly one <h1>, found ${h1Count}`);

  // ── OG/Twitter ─────────────────────────────────────────────────────
  for (const property of ["og:title", "og:description", "og:url", "og:image"]) {
    if (!html.includes(`property="${property}"`)) {
      fail(`${route}: missing ${property}`);
    }
  }
  if (!html.includes('name="twitter:card"')) {
    fail(`${route}: missing twitter:card`);
  }

  // ── JSON-LD parses ─────────────────────────────────────────────────
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
    ),
  ];
  // 404 is noindex; structured data there is pointless.
  if (blocks.length === 0 && !html.includes('name="robots"')) {
    fail(`${route}: no JSON-LD`);
  }
  for (const [, body] of blocks) {
    try {
      const parsed = JSON.parse(body);
      if (!parsed["@context"] || !parsed["@type"]) {
        fail(`${route}: JSON-LD block missing @context/@type`);
      }
    } catch (error) {
      fail(`${route}: unparseable JSON-LD (${error.message})`);
    }
  }

  // ── build stamp ────────────────────────────────────────────────────
  if (!html.includes('name="portal:build"')) {
    fail(`${route}: missing portal:build provenance stamp`);
  }

  // ── the share image actually exists ────────────────────────────────
  // A 404'd og:image renders as a broken share card everywhere the link is
  // posted, and nothing on the page itself looks wrong — so nobody notices.
  const ogImage = html.match(/property="og:image"\s+content="([^"]*)"/)?.[1];
  if (ogImage) {
    const asset = path.join(dist, new URL(ogImage).pathname);
    if (!fs.existsSync(asset)) {
      fail(`${route}: og:image ${ogImage} is not in the build output`);
    }
  }
}

// ── sitemap covers every indexable route ─────────────────────────────

const sitemapIndex = path.join(dist, "sitemap-index.xml");
if (!fs.existsSync(sitemapIndex)) {
  fail("sitemap-index.xml was not emitted");
} else {
  const sitemapUrls = fs
    .readdirSync(dist)
    .filter((f) => /^sitemap-\d+\.xml$/.test(f))
    .flatMap((f) => [
      ...fs
        .readFileSync(path.join(dist, f), "utf8")
        .matchAll(/<loc>([^<]+)<\/loc>/g),
    ])
    .map(([, url]) => new URL(url).pathname);

  for (const page of pages) {
    const noindex = /name="robots"[^>]*content="[^"]*noindex/.test(page.html);
    const listed = sitemapUrls.includes(page.route);

    if (noindex && listed) {
      // Contradictory signals: the sitemap invites indexing, the page
      // forbids it. Crawlers resolve this inconsistently; don't make them.
      fail(`${page.route}: noindex but listed in the sitemap`);
    }
    if (!noindex && !listed) {
      fail(`${page.route}: emitted but absent from the sitemap`);
    }
  }
}

// ── static SEO files ─────────────────────────────────────────────────

for (const file of ["robots.txt", "llms.txt"]) {
  if (!fs.existsSync(path.join(dist, file))) fail(`${file} was not emitted`);
}
const robots = fs.existsSync(path.join(dist, "robots.txt"))
  ? fs.readFileSync(path.join(dist, "robots.txt"), "utf8")
  : "";
if (!robots.includes("Sitemap:")) fail("robots.txt has no Sitemap: line");

// ── pricing page renders a figure or a contact card per tier ─────────

const pricing = pages.find((p) => p.route === "/pricing/");
if (!pricing) {
  fail("no /pricing/ page was emitted");
} else {
  const cards = (pricing.html.match(/class="card"/g) ?? []).length;
  if (cards === 0) {
    fail("/pricing/: no tier cards rendered — the snapshot produced nothing");
  }
  const figures = (pricing.html.match(/class="price__amount"/g) ?? []).length;
  if (figures < cards) {
    fail(
      `/pricing/: ${cards} cards but only ${figures} price figures — a tier rendered without an amount or a contact card`
    );
  }
}

// ── a live-config build must not carry the fixture stamp ─────────────

if (process.env.SITE_CONFIG_URL) {
  for (const page of pages) {
    if (/name="portal:build"[^>]*content="[^"]*fixture/.test(page.html)) {
      fail(
        `${page.route}: built with SITE_CONFIG_URL set but stamped 'fixture' — ` +
          "this build must not be published"
      );
    }
  }
}

// ── report ───────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\nverify-pages — ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(
  `verify-pages — ${pages.length} pages OK ` +
    `(unique titles, canonicals, JSON-LD, sitemap, pricing figures)`
);
