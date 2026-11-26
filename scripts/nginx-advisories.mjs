#!/usr/bin/env node
/**
 * Checks the residency web image's pinned nginx against nginx.org (#918).
 *
 * The web image installs nginx from nginx.org's own apk repository. #918 found
 * the deploy-time image gate (#909) blind to it; since #1096 Trivy matches it
 * by package name, but nginx.org's advisories still land first, and the gate
 * can't act until a fixed -alpine-slim image exists. This check reads the exact
 * version from the Dockerfile's FROM tag and reports two things:
 *   - every nginx.org security advisory whose vulnerable range includes it;
 *   - whether it's stale: a newer stable release exists, or it's on mainline.
 *
 * The weekly `nginx-advisories.yml` workflow runs it and opens or updates one
 * issue when it finds something. It fails closed: a Dockerfile with no
 * readable pin, or a page it can't parse, is "couldn't check" (exit 2), never
 * "clean".
 *
 * Usage:
 *   node scripts/nginx-advisories.mjs --self-test        (npm run lint:nginx-advisories)
 *   node scripts/nginx-advisories.mjs [--version 1.27.5] [--report report.md]
 *        [--dockerfile apps/web/Dockerfile]
 *        [--advisories-file a.html] [--download-file d.html]
 *   Exit: 0 clean · 1 affected or stale · 2 couldn't check.
 *
 * The report ends with a fingerprint comment (the affecting CVEs and the
 * stale reason). The workflow compares it with the open issue's, and comments
 * when it changes: an edited issue body notifies nobody.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ADVISORIES_URL = "https://nginx.org/en/security_advisories.html";
const DOWNLOAD_URL = "https://nginx.org/en/download.html";
/** The image's base, the official nginx image (#1096); a new nginx release
 *  reaches it a day or so later. */
const IMAGE_TAG_URL = (version) =>
  `https://hub.docker.com/v2/repositories/library/nginx/tags/${version}-alpine-slim`;
const DEFAULT_DOCKERFILE = "apps/web/Dockerfile";

/** Patch SLA per nginx severity, in days (docs/SUPPLY_CHAIN.md). An
 *  advisory with no severity gets the strictest: nginx.org dropped every
 *  Severity line from its page in November 2026 (#1096), and an unrated
 *  advisory may be a major one. */
const SLA_DAYS = { major: 7, medium: 30, low: 30, minor: 30 };
const UNRATED_SLA_DAYS = 7;

/**
 * Advisories nginx.org has said it won't fix, by CVE, each with its reason.
 * No release will ever clear one, so no pin can act on it. Named one by one,
 * never by shape: a new advisory with no fix yet looks the same on the page
 * and must still be reported (#1096).
 */
const WONT_FIX = {
  // Log escaping: nginx.org leaves escaping terminal sequences to whatever
  // reads the log. Marked "Severity: none" until the page dropped severities.
  "CVE-2009-4487": "terminal escape sequences in the error log; nginx.org won't fix",
};

// ── Versions ────────────────────────────────────────────────────────────────
function parseVersion(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s).trim());
  if (!m) throw new Error(`not an nginx version: "${s}"`);
  return m.slice(1).map(Number);
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const sameLine = (a, b) => a[0] === b[0] && a[1] === b[1];
const fmt = (v) => v.join(".");
/** Markdown table cells can't hold a raw pipe. */
const cell = (s) => String(s).replace(/\|/g, "\\|");

/**
 * "0.1.29-1.31.6", "1.31.2-1.31.6, 1.30.0-1.30.5", "1.25.3" or "all".
 * Returns null for a range on another platform ("nginx/Windows …"), which
 * doesn't apply to a Linux image.
 */
export function parseVulnerable(text) {
  const t = text.trim();
  if (t === "all") return [{ all: true }];
  if (/^nginx\/\w+/.test(t)) return null;
  return t.split(",").map((part) => {
    const [lo, hi] = part.trim().split("-");
    return { lo: parseVersion(lo), hi: parseVersion(hi ?? lo) };
  });
}

/** "1.31.7+, 1.30.6+" or "none". */
export function parseNotVulnerable(text) {
  const t = text.trim();
  if (t === "none" || t === "") return [];
  return t.split(",").map((part) => {
    const m = /^([\d.]+)\+$/.exec(part.trim());
    if (!m) throw new Error(`unreadable "Not vulnerable" entry: "${part}"`);
    return parseVersion(m[1]);
  });
}

/**
 * "1.30.6+" covers later 1.30.x. The highest entry also covers every later
 * line, which is how nginx.org writes a fix that went to mainline.
 */
function isFixed(v, fixes) {
  if (fixes.length === 0) return false;
  const highest = fixes.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
  return fixes.some((f) => compare(v, f) >= 0 && (sameLine(v, f) || f === highest));
}

function inRanges(v, ranges) {
  return ranges.some((r) => r.all || (compare(v, r.lo) >= 0 && compare(v, r.hi) <= 0));
}

// ── Pages ───────────────────────────────────────────────────────────────────
const stripTags = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/** Each advisory is one `<li><p>` whose lines are separated by `<br>`. */
export function parseAdvisories(html) {
  const items = [...html.matchAll(/<li><p>([\s\S]*?)<\/p><\/li>/g)].map((m) => m[1]);
  const advisories = [];
  for (const item of items) {
    const lines = item.split(/<br\s*\/?>/i).map(stripTags).filter(Boolean);
    const field = (name) => {
      const line = lines.find((l) => l.startsWith(`${name}:`));
      return line === undefined ? undefined : line.slice(name.length + 1).trim();
    };
    const vulnerable = field("Vulnerable");
    // An item with a severity, a CVE or a "Not vulnerable:" line is an
    // advisory (the page has had no Severity lines since November 2026, and
    // not every advisory has a CVE). One whose affected versions can't be read
    // means the page format changed, and skipping it would drop exactly the
    // newest advisory: fail instead.
    const advisoryShaped =
      field("Severity") !== undefined ||
      field("Not vulnerable") !== undefined ||
      lines.some((l) => /^CVE-\d{4}-\d+$/.test(l));
    if (vulnerable === undefined) {
      if (advisoryShaped) throw new Error(`advisory "${lines[0]}" has no readable "Vulnerable:" line`);
      continue; // a list item that isn't an advisory
    }
    const cves = lines.filter((l) => /^CVE-\d{4}-\d+$/.test(l));
    advisories.push({
      title: lines[0],
      severity: (field("Severity") ?? "").toLowerCase(),
      cves,
      fixed: parseNotVulnerable(field("Not vulnerable") ?? "none"),
      ranges: parseVulnerable(vulnerable),
      wontFix: cves.length > 0 && cves.every((c) => c in WONT_FIX),
    });
  }
  if (advisories.length === 0) throw new Error("no advisories found on the nginx.org page");
  return advisories;
}

/** The download page's "Stable version" section names one nginx-x.y.z. */
export function parseStable(html) {
  const at = html.indexOf("Stable version");
  const m = at === -1 ? null : /nginx-(\d+\.\d+\.\d+)/.exec(html.slice(at));
  if (!m) throw new Error("no stable version found on the nginx.org download page");
  return m[1];
}

/**
 * The shipped stage is `FROM [--flag=value …] <nginx image>:<x.y.z…> AS runtime`;
 * its tag must name the exact patch, e.g. 1.30.6-alpine-slim.
 */
export function readPin(dockerfile) {
  const m = /^FROM\s+(?:--\S+\s+)*\S*nginx[^\s:]*:(\d+\.\d+\.\d+)\S*\s+AS\s+runtime\s*$/im.exec(dockerfile);
  if (!m) throw new Error("no runtime-stage nginx FROM with an exact x.y.z tag in the Dockerfile");
  return m[1];
}

// ── Decision ────────────────────────────────────────────────────────────────
/**
 * Pure assessment.
 * @returns {{ affecting: object[], stale: string | null }}
 */
export function assess({ pinned, advisories, stable, stableImageExists = true }) {
  const v = parseVersion(pinned);
  const s = parseVersion(stable);
  const affecting = advisories.filter(
    (a) =>
      a.severity !== "none" &&
      !a.wontFix &&
      a.ranges !== null &&
      inRanges(v, a.ranges) &&
      !isFixed(v, a.fixed)
  );
  let stale = null;
  if (v[1] % 2 === 1) stale = `${pinned} is a mainline release; the image should run stable (${stable}).`;
  // A release with no -alpine-slim image yet isn't actionable: the fix step
  // would fail. The next weekly run picks it up once the image ships.
  else if (compare(s, v) > 0 && stableImageExists) {
    stale = sameLine(s, v)
      ? `stable ${stable} is out; the image pins ${pinned}.`
      : `the stable line is now ${s[0]}.${s[1]} (${stable}); the image pins ${pinned}, which is end of life.`;
  }
  return { affecting, stale };
}

/** What a reader needs to hear about when it changes. */
export function fingerprint({ affecting, stale }) {
  const cves = affecting.map((a) => a.cves.join("+") || a.title).sort();
  return `<!-- nginx-advisories: ${cves.join(",") || "none"}; stale: ${stale ? "yes" : "no"} -->`;
}

/** `source` is the Dockerfile to fix; `origin` is where the version came from. */
export function renderReport({ pinned, source, origin = source, affecting, stale }) {
  const out = [`Pinned nginx: **${pinned}** (${origin})`, ""];
  if (affecting.length === 0 && !stale) {
    out.push("No nginx.org advisory affects it, and it is the current stable release.");
    return out.join("\n");
  }
  if (affecting.length > 0) {
    out.push("**Advisories affecting it** ([nginx.org](" + ADVISORIES_URL + ")):", "");
    out.push("| Advisory | Severity | CVE | Fixed in | Patch within |", "|---|---|---|---|---|");
    for (const a of affecting) {
      const sla = `${SLA_DAYS[a.severity] ?? UNRATED_SLA_DAYS} days`;
      out.push(
        `| ${cell(a.title)} | ${cell(a.severity || "unrated")} | ${cell(a.cves.join(", ") || "—")} | ${a.fixed.map(fmt).join(", ") || "—"} | ${sla} |`
      );
    }
    out.push("");
  }
  if (stale) out.push(`**Stale:** ${stale}`, "");
  out.push(
    `**To fix:** move ${source}'s runtime \`FROM\` to the official \`nginx\` image's stable \`-alpine-slim\` tag for the fixed version, and pin its index digest (\`docker buildx imagetools inspect nginx:<tag>\`). Bump the tag and the digest together; the deploy's image gate covers the rest of the image.`,
    "",
    fingerprint({ affecting, stale })
  );
  return out.join("\n");
}

// ── Self-test ───────────────────────────────────────────────────────────────
const li = (title, severity, fixed, vulnerable, cve = "") =>
  `<li><p>${title}<br>Severity: ${severity}<br><a href="x">Advisory</a><br>` +
  (cve ? `<a href="y">${cve}</a><br>` : "") +
  `Not vulnerable: ${fixed}<br>Vulnerable: ${vulnerable}</p></li>`;

// Shaped like nginx.org's page on 2026-10-29: the two newest advisories
// verbatim, plus the format's edge cases. The won't-fix entry is in the
// page's 2026-11-26 shape, with no Severity line (#1096).
const ADVISORIES_FIXTURE = `<nav><ul><li><a href="/">news</a></li></ul></nav><ul>
${li("Buffer overflow when using alias with rewrite", "medium", "1.31.7+, 1.30.6+", "0.1.29-1.31.6", "CVE-2026-15176")}
${li("Buffer overflow in script evaluation", "medium", "1.31.7+, 1.30.6+", "1.31.2-1.31.6, 1.30.0-1.30.5", "CVE-2026-93479")}
${li("NULL pointer dereference in HTTP/3", "major", "1.25.4+", "1.25.3", "CVE-2024-24989")}
${li("Windows path issue", "major", "0.8.40+", "nginx/Windows 0.7.52-0.8.39")}
<li><p>An error log data are not sanitized<br><a href="z">CVE-2009-4487</a><br>Not vulnerable: none<br>Vulnerable: all</p></li>
${li("Old line fix", "low", "1.29.7+, 1.28.3+", "1.5.6-1.29.6")}
${li("Fix | reached later lines", "low", "1.29.9+, 1.28.4+", "1.0.0-1.31.6", "CVE-2099-0001")}
</ul>`;
const DOWNLOAD_FIXTURE = `<h4>Mainline version</h4><a>nginx-1.31.8</a><h4>Stable version</h4><a>nginx-1.30.6</a><h4>Legacy versions</h4><a>nginx-1.28.3</a>`;

const CASES = [
  { name: "the pinned stable release with no open advisory is clean", pinned: "1.30.6", expect: { cves: [], stale: false } },
  { name: "1.27.5 (the pre-#918 pin) is affected and end of life", pinned: "1.27.5", expect: { cves: ["CVE-2026-15176", "CVE-2099-0001"], titles: ["Old line fix"], stale: true } },
  { name: "1.30.5 is affected by both current advisories and stale", pinned: "1.30.5", expect: { cves: ["CVE-2026-15176", "CVE-2026-93479"], stale: true } },
  { name: "a mainline pin is stale even when patched", pinned: "1.31.7", expect: { cves: [], stale: true } },
  { name: "a single-version range matches only that version", pinned: "1.25.3", expect: { cves: ["CVE-2024-24989", "CVE-2026-15176", "CVE-2099-0001"], stale: true } },
  { name: "a fix on its own line counts (1.28.3+)", pinned: "1.28.5", expect: { cves: ["CVE-2026-15176"], titles: [], stale: true } },
  // 1.30.6 is inside CVE-2099-0001's range (to 1.31.6); only the highest
  // fix (1.29.9+) reaching later lines makes it clean.
  { name: "the highest fix covers later lines (1.29.9+ fixes 1.30.6)", pinned: "1.30.6", expect: { cves: [], titles: [], stale: false } },
  { name: "an older patch on the highest fix's own line isn't fixed", pinned: "1.29.8", expect: { cves: ["CVE-2026-15176", "CVE-2099-0001"], stale: true } },
];

const PARSE_FAILURES = [
  { name: "an empty advisories page fails", run: () => parseAdvisories("<html></html>") },
  { name: "a download page with no stable version fails", run: () => parseStable("<h4>Mainline version</h4>nginx-1.31.8") },
  { name: "a Dockerfile pinned by a moving tag fails", run: () => readPin("FROM nginx:stable-alpine-slim@sha256:abc AS runtime") },
  {
    name: "an advisory with no Severity or CVE whose affected versions are relabelled fails (the page's 2026-11 shape)",
    run: () => parseAdvisories("<li><p>New thing<br>Not vulnerable: 1.30.9+<br>Affected: 1.30.0-1.30.8</p></li>"),
  },
  { name: "an unreadable version range fails", run: () => parseAdvisories(li("x", "low", "1.0.0+", "soon")) },
  {
    name: "an advisory whose affected versions are relabelled fails, even among readable ones",
    run: () => parseAdvisories(`${ADVISORIES_FIXTURE}<li><p>New thing<br>Severity: major<br>Affected: 1.30.6</p></li>`),
  },
];

function selfTest() {
  let failed = 0;
  let total = 0;
  const check = (name, ok, detail) => {
    total += 1;
    console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
    if (!ok) failed += 1;
  };

  const advisories = parseAdvisories(ADVISORIES_FIXTURE);
  const stable = parseStable(DOWNLOAD_FIXTURE);
  check("parses every advisory and the stable version", advisories.length === 7 && stable === "1.30.6", `${advisories.length} advisories, stable ${stable}`);
  check(
    "reads the exact pin from the real Dockerfile shape",
    readPin("FROM node:22-alpine AS build\nFROM nginx:1.30.8-alpine-slim@sha256:e9ea AS runtime") === "1.30.8",
    "wrong pin"
  );
  check(
    "reads a pin from another nginx image too (the pre-#1096 base)",
    readPin("FROM nginxinc/nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8b AS runtime") === "1.30.6",
    "wrong pin"
  );
  check(
    "reads the runtime stage's pin past a --platform flag and an earlier nginx stage",
    readPin(
      "FROM nginx:1.25.0 AS helper\nFROM --platform=$TARGETPLATFORM nginxinc/nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8b AS runtime"
    ) === "1.30.6",
    "wrong pin"
  );
  check(
    "a newer stable release counts as stale only once its image exists",
    assess({ pinned: "1.30.6", advisories, stable: "1.30.7", stableImageExists: false }).stale === null &&
      assess({ pinned: "1.30.6", advisories, stable: "1.30.7", stableImageExists: true }).stale !== null,
    "wrong staleness"
  );

  for (const c of CASES) {
    const got = assess({ pinned: c.pinned, advisories, stable });
    const cves = got.affecting.flatMap((a) => a.cves).sort();
    const titles = got.affecting.filter((a) => a.cves.length === 0).map((a) => a.title);
    const ok =
      JSON.stringify(cves) === JSON.stringify([...c.expect.cves].sort()) &&
      (c.expect.titles === undefined || JSON.stringify(titles) === JSON.stringify(c.expect.titles)) &&
      Boolean(got.stale) === c.expect.stale &&
      !got.affecting.some((a) => a.severity === "none" || a.ranges === null);
    check(c.name, ok, `got cves ${JSON.stringify(cves)}, untitled ${JSON.stringify(titles)}, stale ${JSON.stringify(got.stale)}`);
  }

  for (const f of PARSE_FAILURES) {
    let threw = false;
    try {
      f.run();
    } catch {
      threw = true;
    }
    check(f.name, threw, "did not throw");
  }

  const report = renderReport({ pinned: "1.27.5", source: "`apps/web/Dockerfile`", ...assess({ pinned: "1.27.5", advisories, stable }) });
  check(
    "the report names the CVE, its SLA, the fix and the source file",
    /CVE-2026-15176/.test(report) && /30 days/.test(report) && /\*\*To fix:\*\* move `apps\/web\/Dockerfile`'s/.test(report),
    report
  );
  check("the report escapes a pipe in a title", report.includes("Fix \\| reached later lines"), report);
  // The page's 2026-11 shape: no Severity lines (#1096).
  const unrated = parseAdvisories(
    '<li><p>Heap overflow in a new module<br><a href="x">CVE-2099-0002</a><br>Not vulnerable: none<br>Vulnerable: all</p></li>' +
      '<li><p>An error log data are not sanitized<br><a href="z">CVE-2009-4487</a><br>Not vulnerable: none<br>Vulnerable: all</p></li>'
  );
  const unratedResult = assess({ pinned: "1.30.6", advisories: unrated, stable: "1.30.6" });
  check(
    "a new advisory with no fix yet is reported; only a listed won't-fix CVE is skipped",
    JSON.stringify(unratedResult.affecting.flatMap((x) => x.cves)) === JSON.stringify(["CVE-2099-0002"]),
    JSON.stringify(unratedResult.affecting.map((x) => x.cves))
  );
  const unratedReport = renderReport({ pinned: "1.30.6", source: "`apps/web/Dockerfile`", ...unratedResult });
  check(
    "an advisory with no severity gets the strictest SLA (7 days)",
    /\| unrated \| CVE-2099-0002 \| — \| 7 days \|/.test(unratedReport),
    unratedReport
  );
  check(
    "the report ends with a fingerprint of the affecting CVEs",
    report.trim().endsWith("<!-- nginx-advisories: CVE-2026-15176,CVE-2099-0001,Old line fix; stale: yes -->"),
    report.trim().split("\n").pop()
  );

  if (failed) {
    console.error(`nginx-advisories self-test: ${failed} of ${total} case(s) failed`);
    process.exit(1);
  }
  console.log(`nginx-advisories self-test: ${total} case(s) passed`);
}

// ── Entrypoint ──────────────────────────────────────────────────────────────
function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

/**
 * Whether the official nginx image has published `<version>-alpine-slim` yet. A
 * failed lookup answers true, so a Docker Hub outage reports a newer
 * release rather than hiding it.
 */
async function imageExists(version) {
  try {
    const res = await fetch(IMAGE_TAG_URL(version), { signal: AbortSignal.timeout(30_000) });
    return res.status !== 404;
  } catch {
    return true;
  }
}

async function main() {
  const reportPath = arg("--report");
  let report;
  let code;
  let pinned = arg("--version");
  const dockerfile = arg("--dockerfile") ?? DEFAULT_DOCKERFILE;
  const source = `\`${dockerfile}\``;
  const origin = pinned ? "`--version`" : source;
  try {
    pinned ??= readPin(readFileSync(dockerfile, "utf8"));
    parseVersion(pinned);
    const advisoriesFile = arg("--advisories-file");
    const downloadFile = arg("--download-file");
    const [advisoriesHtml, downloadHtml] = await Promise.all([
      advisoriesFile ? readFileSync(advisoriesFile, "utf8") : fetchText(ADVISORIES_URL),
      downloadFile ? readFileSync(downloadFile, "utf8") : fetchText(DOWNLOAD_URL),
    ]);
    const stable = parseStable(downloadHtml);
    const result = assess({
      pinned,
      advisories: parseAdvisories(advisoriesHtml),
      stable,
      stableImageExists: compare(parseVersion(stable), parseVersion(pinned)) > 0 ? await imageExists(stable) : true,
    });
    report = renderReport({ pinned, source, origin, ...result });
    code = result.affecting.length > 0 || result.stale ? 1 : 0;
  } catch (err) {
    report =
      `**The nginx advisory check couldn't run**, so the web image's nginx (${pinned ?? "unknown"}) is unchecked: ` +
      `${String(err.message ?? err)}.\n\nFix \`scripts/nginx-advisories.mjs\` (or the Dockerfile's pin) and re-run the workflow.`;
    code = 2;
  }
  console.log(report);
  if (reportPath) writeFileSync(reportPath, `${report}\n`);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else await main();
}
