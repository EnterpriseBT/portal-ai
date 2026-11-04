#!/usr/bin/env node
/**
 * Builds the accessibility audit inventory (#792, epic #791).
 *
 * Three report-only tools write raw results into a gitignored `a11y-results/`
 * directory in each package:
 *   - jsx-a11y      `npm run a11y:lint`     (web, core, site)  → eslint.json
 *   - jest-axe      `npm run a11y:stories`  (web, core)        → stories.json
 *   - axe (browser) `npm run a11y:axe[:site]` (e2e)            → app.json, site.json
 * This script reads all of them, normalizes every finding to one shape (WCAG
 * criterion, location, where it was seen, owning epic child), and rewrites
 * the generated section of `docs/A11Y_AUDIT.md` between its markers. The
 * keyboard and screen-reader sections outside the markers are hand-written
 * and never touched; their KB-/SR- rows are only counted.
 *
 * It fails on setup problems and never on findings. A missing input, an input
 * with no successful run, a jsx-a11y rule with no WCAG mapping, or missing
 * markers all exit 1: an empty or partial report would read as conformance.
 *
 * Usage:
 *   node scripts/a11y-inventory.mjs               (npm run a11y:inventory)
 *   node scripts/a11y-inventory.mjs --self-test   (npm run lint:a11y-inventory)
 *   Exit: 0 written · 1 setup problem.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class InventoryError extends Error {}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every raw result the inventory needs, relative to the repo root. */
export const INPUTS = [
  { file: "apps/web/a11y-results/eslint.json", kind: "eslint", package: "apps/web" },
  { file: "apps/web/a11y-results/stories.json", kind: "raw", package: "apps/web" },
  { file: "packages/core/a11y-results/eslint.json", kind: "eslint", package: "packages/core" },
  { file: "packages/core/a11y-results/stories.json", kind: "raw", package: "packages/core" },
  { file: "apps/site/a11y-results/eslint.json", kind: "eslint", package: "apps/site" },
  { file: "packages/e2e/a11y-results/app.json", kind: "raw", package: "apps/web" },
  { file: "packages/e2e/a11y-results/site.json", kind: "raw", package: "apps/site" },
];

export const DOC = "docs/A11Y_AUDIT.md";
export const START = "<!-- a11y-inventory:start -->";
export const END = "<!-- a11y-inventory:end -->";

/** The epic's area children: every finding lands in one of these, or in
 *  `unassigned`. */
export const OWNERS = {
  793: "Dialogs and forms",
  794: "Tables, grids and lists",
  795: "RegionEditor spreadsheet canvas",
  796: "Maps and charts",
  797: "App shell, navigation and landmarks",
  798: "Marketing site",
};

/**
 * jsx-a11y rule → WCAG 2.2 success criteria. jsx-a11y results carry no
 * criterion of their own, so every rule the report runs must be listed: an
 * unlisted one fails the run rather than producing a row with no criterion.
 * `astro/jsx-a11y/<rule>` resolves through the same key. `[]` is a
 * deliberate "best practice, no criterion of its own" (the generator lists
 * it as such), distinct from a missing key.
 */
export const JSX_A11Y_WCAG = {
  "alt-text": ["1.1.1"],
  "anchor-has-content": ["2.4.4", "4.1.2"],
  "anchor-is-valid": ["2.1.1", "2.4.4"],
  "aria-activedescendant-has-tabindex": ["2.1.1"],
  "aria-props": ["4.1.2"],
  "aria-proptypes": ["4.1.2"],
  "aria-role": ["4.1.2"],
  "aria-unsupported-elements": ["4.1.2"],
  "autocomplete-valid": ["1.3.5"],
  "click-events-have-key-events": ["2.1.1"],
  "heading-has-content": ["1.3.1", "2.4.6"],
  "html-has-lang": ["3.1.1"],
  "iframe-has-title": ["4.1.2"],
  "img-redundant-alt": ["1.1.1"],
  "interactive-supports-focus": ["2.1.1"],
  "label-has-associated-control": ["1.3.1", "3.3.2", "4.1.2"],
  "media-has-caption": ["1.2.2"],
  "mouse-events-have-key-events": ["2.1.1"],
  "no-access-key": [],
  "no-autofocus": [],
  "no-distracting-elements": ["2.2.2"],
  "no-interactive-element-to-noninteractive-role": ["4.1.2"],
  "no-noninteractive-element-interactions": ["4.1.2"],
  "no-noninteractive-element-to-interactive-role": ["4.1.2"],
  "no-noninteractive-tabindex": ["2.4.3"],
  "no-redundant-roles": [],
  "no-static-element-interactions": ["2.1.1", "4.1.2"],
  "role-has-required-aria-props": ["4.1.2"],
  "role-supports-aria-props": ["4.1.2"],
  scope: ["1.3.1"],
  "tabindex-no-positive": ["2.4.3"],
};

/** axe rules that describe the page shell rather than the view inside it. On
 *  an app route they belong to #797 whatever the route's own owner is. */
const SHELL_RULES = new Set(["region", "bypass", "document-title", "html-has-lang", "page-has-heading-one"]);
const isShellRule = (rule) => SHELL_RULES.has(rule) || rule.startsWith("landmark-");

/** Path patterns → owner, first match wins. Matched against "/" + the
 *  repo-relative path, so a pattern can anchor on a directory. */
const PATH_OWNERS = [
  [/\/modules\/RegionEditor\//, 795],
  [/\/modules\/(MapWidget|D3Widget)\//, 796],
  [/(\/layouts\/|SidebarNav|HeaderMenu|\/views\/Loading\.view)/, 797],
  [/(\/ui\/DataTable|DataTableBlock|PaginationToolbar|\/modules\/TableWidget\/|EntityRecordDataTable|KeyValueTable)/, 794],
  [/(\/ui\/Modal|Dialog\.component|FormAlert|\/workflows\/)/, 793],
];

const JSX_A11Y_PREFIX = /^(astro\/)?jsx-a11y\//;

/** axe tags `wcag143` / `wcag1410` → "1.4.3" / "1.4.10"; level tags such as
 *  `wcag2aa` and every non-wcag tag are ignored. Sorted, deduplicated. */
export function wcagFromTags(tags) {
  const out = new Set();
  for (const tag of tags ?? []) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (m) out.add(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...out].sort(compareCriteria);
}

function compareCriteria(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const findingId = (tool, rule, location) => createHash("sha1").update(`${tool}|${rule}|${location}`).digest("hex").slice(0, 8);

function ownerFor({ tool, pkg, rule, file, routeOwner }) {
  if (tool === "axe-app" && isShellRule(rule)) return 797;
  if (pkg === "apps/site" || tool === "axe-site") return 798;
  if (file) {
    const probe = `/${file}`;
    for (const [pattern, owner] of PATH_OWNERS) if (pattern.test(probe)) return owner;
  }
  if (tool === "axe-app" && OWNERS[routeOwner]) return Number(routeOwner);
  return "unassigned";
}

/** ESLint's JSON formatter output → findings. Only jsx-a11y rules count: the
 *  report config spreads the package's normal config, which `lint` keeps at
 *  zero problems. A message with no ruleId is a fatal parse error. */
export function normalizeEslint(results, { package: pkg, root, wcagMap = JSX_A11Y_WCAG }) {
  const findings = [];
  for (const result of results) {
    const file = path.relative(root, result.filePath).split(path.sep).join("/");
    for (const msg of result.messages ?? []) {
      if (!msg.ruleId) {
        throw new InventoryError(`fatal parse error in ${file}:${msg.line ?? "?"}: ${msg.message}`);
      }
      if (!JSX_A11Y_PREFIX.test(msg.ruleId)) continue;
      const key = msg.ruleId.replace(JSX_A11Y_PREFIX, "");
      const wcag = wcagMap[key];
      if (!wcag) {
        throw new InventoryError(`jsx-a11y rule "${msg.ruleId}" has no WCAG mapping; add "${key}" to JSX_A11Y_WCAG in scripts/a11y-inventory.mjs`);
      }
      const rule = `jsx-a11y/${key}`;
      const location = `${file}:${msg.line}`;
      findings.push({
        tool: "eslint",
        package: pkg,
        rule,
        impact: null,
        wcag: [...wcag].sort(compareCriteria),
        location,
        file,
        seen: [{ role: null, state: null, theme: null }],
        owner: ownerFor({ tool: "eslint", pkg, rule, file }),
        message: msg.message,
      });
    }
  }
  return findings;
}

/** A RawResultFile (stories sweep, app walk, site walk) → findings. One
 *  finding per violated node; skipped runs produce none. */
export function normalizeRaw(data, { package: pkg }) {
  const findings = [];
  for (const run of data.runs ?? []) {
    if (run.status !== "ok") continue;
    const ctx = run.context ?? {};
    // Writers record story files repo-relative, so path owners match them
    // the same way they match ESLint's.
    const file = ctx.file;
    for (const v of run.violations ?? []) {
      for (const node of v.nodes ?? []) {
        const target = (node.target ?? []).join(" > ");
        const where = file ? `${file} › ${ctx.story ?? ""}` : (ctx.route ?? ctx.url ?? "?");
        const location = `${where} ${target}`.trim();
        findings.push({
          tool: data.tool,
          package: pkg,
          rule: v.id,
          impact: v.impact ?? null,
          wcag: wcagFromTags(v.tags),
          location,
          file,
          seen: [{ role: ctx.role ?? null, state: ctx.state ?? null, theme: ctx.theme ?? null }],
          owner: ownerFor({ tool: data.tool, pkg, rule: v.id, file, routeOwner: ctx.owner }),
        });
      }
    }
  }
  return findings;
}

function okRuns(input, data) {
  if (input.kind === "eslint") return Array.isArray(data) ? data.length : 0;
  return (data.runs ?? []).filter((r) => r.status === "ok").length;
}

/**
 * sources: [{ input, data, root? }] → { findings, coverage }. Findings with the
 * same (tool, rule, location) merge their sightings; color-contrast also keys
 * on theme, since the two palettes fail independently.
 */
export function buildInventory(sources, { wcagMap = JSX_A11Y_WCAG } = {}) {
  const coverage = [];
  const merged = new Map();
  for (const { input, data, root = "/" } of sources) {
    const ok = okRuns(input, data);
    if (ok === 0) {
      throw new InventoryError(`${input.file} has no successful run; an empty result isn't a clean one. Re-run its tool.`);
    }
    const skipped = input.kind === "raw" ? (data.runs ?? []).filter((r) => r.status !== "ok") : [];
    coverage.push({
      file: input.file,
      tool: input.kind === "eslint" ? "eslint" : data.tool,
      package: input.package,
      version: input.kind === "eslint" ? null : (data.axeVersion ?? null),
      ok,
      skipped: skipped.map((r) => ({ context: r.context ?? {}, error: r.error ?? "" })),
    });
    const found =
      input.kind === "eslint"
        ? normalizeEslint(data, { package: input.package, root, wcagMap })
        : normalizeRaw(data, { package: input.package });
    for (const f of found) {
      const theme = f.rule === "color-contrast" ? (f.seen[0].theme ?? "") : "";
      const key = `${f.tool}|${f.rule}|${f.location}|${theme}`;
      const prior = merged.get(key);
      if (!prior) {
        merged.set(key, { ...f, id: findingId(f.tool, f.rule, `${f.location}${theme ? `|${theme}` : ""}`) });
        continue;
      }
      for (const s of f.seen) {
        if (!prior.seen.some((p) => p.role === s.role && p.state === s.state && p.theme === s.theme)) prior.seen.push(s);
      }
    }
  }
  const findings = [...merged.values()].sort(
    (a, b) =>
      String(a.owner).localeCompare(String(b.owner)) ||
      compareCriteria(a.wcag[0] ?? "9.9.9", b.wcag[0] ?? "9.9.9") ||
      a.rule.localeCompare(b.rule) ||
      a.location.localeCompare(b.location)
  );
  return { findings, coverage };
}

/** Counts the hand-written KB-/SR- rows per owner. The owner is the row's
 *  last cell, written "#79x". */
export function parseManual(doc) {
  const counts = {};
  for (const line of doc.split("\n")) {
    if (!/^\|\s*(KB|SR)-\d+\s*\|/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c, i, all) => i > 0 && i < all.length - 1);
    const m = /#(\d+)/.exec(cells[cells.length - 1] ?? "");
    const owner = m && OWNERS[m[1]] ? m[1] : "unassigned";
    counts[owner] = (counts[owner] ?? 0) + 1;
  }
  return counts;
}

/** Markdown table cells can't hold a raw pipe or a newline. */
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

function seenSummary(seen) {
  const part = (label, key) => {
    const values = [...new Set(seen.map((s) => s[key]).filter(Boolean))].sort();
    return values.length ? `${label}: ${values.join(", ")}` : null;
  };
  return [part("roles", "role"), part("states", "state"), part("themes", "theme")].filter(Boolean).join(" · ") || "—";
}

const contextLabel = (ctx) =>
  [ctx.file && `${ctx.file} › ${ctx.story ?? ""}`, ctx.route, ctx.role, ctx.state, ctx.theme].filter(Boolean).join(" · ");

/** The text that goes between the markers. Deterministic: no timestamps. */
export function renderGenerated({ findings, coverage }, manual = {}) {
  const lines = [];
  lines.push("## Coverage", "");
  lines.push("| Result file | Tool | Version | Runs ok | Skipped |", "|---|---|---|---|---|");
  for (const c of coverage) {
    lines.push(`| \`${c.file}\` | ${c.tool} | ${c.version ?? "—"} | ${c.ok} | ${c.skipped.length} |`);
  }
  const skipped = coverage.flatMap((c) => c.skipped.map((s) => ({ ...s, file: c.file })));
  if (skipped.length) {
    lines.push("", "Skipped runs (not audited; each is a coverage gap until it renders):", "");
    for (const s of skipped) lines.push(`- \`${s.file}\` · ${cell(contextLabel(s.context))}: ${cell(s.error)}`);
  }

  const groups = [...Object.keys(OWNERS), "unassigned"];
  lines.push("", "## Summary", "");
  lines.push("| Owner | Automated findings | WCAG criteria | Keyboard / screen-reader findings |", "|---|---|---|---|");
  for (const g of groups) {
    const mine = findings.filter((f) => String(f.owner) === g);
    const criteria = [...new Set(mine.flatMap((f) => f.wcag))].sort(compareCriteria);
    const label = g === "unassigned" ? "Unassigned" : `[#${g} ${OWNERS[g]}](#owner-${g})`;
    lines.push(`| ${label} | ${mine.length} | ${criteria.join(", ") || "—"} | ${manual[g] ?? 0} |`);
  }

  for (const g of groups) {
    const mine = findings.filter((f) => String(f.owner) === g);
    lines.push("");
    lines.push(g === "unassigned" ? '<a id="owner-unassigned"></a>' : `<a id="owner-${g}"></a>`, "");
    lines.push(g === "unassigned" ? "## Unassigned" : `## #${g} ${OWNERS[g]}`, "");
    if (!mine.length) {
      lines.push("No automated findings.");
      continue;
    }
    lines.push("| ID | WCAG | Rule | Impact | Location | Seen | Tool |", "|---|---|---|---|---|---|---|");
    for (const f of mine) {
      lines.push(
        `| ${f.id} | ${f.wcag.join(", ") || "best practice"} | ${cell(f.rule)} | ${f.impact ?? "—"} | ${cell(f.location)} | ${cell(seenSummary(f.seen))} | ${f.tool} |`
      );
    }
  }
  return lines.join("\n");
}

/** Replaces the text between the one START and the one END marker. */
export function replaceGenerated(doc, generated) {
  const count = (marker) => doc.split(marker).length - 1;
  if (count(START) !== 1 || count(END) !== 1) {
    throw new InventoryError(`${DOC} must hold exactly one ${START} and one ${END} marker`);
  }
  const i = doc.indexOf(START);
  const j = doc.indexOf(END);
  if (j < i) throw new InventoryError(`${DOC}'s end marker comes before its start marker`);
  return `${doc.slice(0, i + START.length)}\n${generated}\n${doc.slice(j)}`;
}

const ruleIsOn = (v) => !(v === "off" || v === 0 || (Array.isArray(v) && (v[0] === "off" || v[0] === 0)));

/** The jsx-a11y rule names (prefix stripped) the report configs enable:
 *  jsx-a11y's `strict` (web, core) and eslint-plugin-astro's
 *  `flat/jsx-a11y-strict` (site), each resolved from the package that uses it. */
export async function enabledJsxA11yRulesAsync(root = REPO_ROOT) {
  const requireFrom = (pkg) => createRequire(path.join(root, pkg, "package.json"));
  const jsxA11y = requireFrom("apps/web")("eslint-plugin-jsx-a11y");
  const astroPath = requireFrom("apps/site").resolve("eslint-plugin-astro");
  const astro = (await import(pathToFileURL(astroPath).href)).default;
  const rules = new Set();
  for (const [k, v] of Object.entries(jsxA11y.flatConfigs.strict.rules)) if (ruleIsOn(v)) rules.add(k.replace(JSX_A11Y_PREFIX, ""));
  for (const block of astro.configs["flat/jsx-a11y-strict"]) {
    for (const [k, v] of Object.entries(block.rules ?? {})) if (JSX_A11Y_PREFIX.test(k) && ruleIsOn(v)) rules.add(k.replace(JSX_A11Y_PREFIX, ""));
  }
  return [...rules].sort();
}

/** Reads every input; a missing or unparseable one fails, naming it. */
export function readInputs(root) {
  return INPUTS.map((input) => {
    const full = path.join(root, input.file);
    if (!existsSync(full)) {
      throw new InventoryError(`${input.file} is missing; run the tool that writes it (npm run a11y:report runs them all)`);
    }
    let data;
    try {
      data = JSON.parse(readFileSync(full, "utf8"));
    } catch (err) {
      throw new InventoryError(`${input.file} isn't valid JSON: ${err.message}`);
    }
    return { input, data, root };
  });
}
// ── end implementation ──────────────────────────────────────────────────────

// ── Self-test ───────────────────────────────────────────────────────────────
const TEST_MAP = { "alt-text": ["1.1.1"], "anchor-is-valid": ["2.1.1"] };

const eslintFile = (filePath, ruleIds) => [
  {
    filePath,
    messages: ruleIds.map((ruleId, i) => ({ ruleId, line: 10 + i, column: 3, severity: 2, message: `${ruleId} problem` })),
  },
];

const rawFile = (tool, runs) => ({ tool, package: "x", generatedAt: "2026-11-04T00:00:00Z", axeVersion: "4.14.0", runs });
const violation = (id, tags, target = ["#main > div"]) => ({ id, impact: "serious", tags, nodes: [{ target }] });
const appRun = (route, owner, violations, seen = {}) => ({
  context: { route, owner, role: "owner", state: "populated", theme: "brand", ...seen },
  status: "ok",
  violations,
});

const DOC_FIXTURE = [
  "# Accessibility audit inventory",
  "",
  "Intro text.",
  "",
  START,
  "old generated text",
  END,
  "",
  "## Keyboard pass",
  "",
  "| ID | Flow | Step | WCAG | Observed | AT | Owner |",
  "|---|---|---|---|---|---|---|",
  "| KB-01 | Sign-in | 2 | 2.4.7 | no focus ring | keyboard | #797 |",
  "| SR-01 | Sign-in | 3 | 4.1.2 | unnamed button | VoiceOver | #793 |",
  "| SR-02 | Pricing | 1 | 1.3.1 | table headers | NVDA | #798 |",
  "",
].join("\n");

async function selfTest() {
  let failed = 0;
  let total = 0;
  const check = (name, ok, detail) => {
    total += 1;
    console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
    if (!ok) failed += 1;
  };
  const attempt = (fn) => {
    try {
      return { value: fn() };
    } catch (err) {
      return { error: err };
    }
  };
  const throws = (name, fn, pattern) => {
    const r = attempt(fn);
    check(
      name,
      r.error instanceof InventoryError && pattern.test(r.error.message),
      r.error ? `threw ${r.error.constructor.name}: ${r.error.message}` : "did not throw"
    );
  };
  const run = (name, fn) => {
    const r = attempt(fn);
    if (r.error) check(name, false, `threw: ${r.error.message}`);
    return r.value;
  };
  const build = (sources, map = TEST_MAP) => buildInventory(sources, { wcagMap: map });

  // Criteria
  run("wcag tags", () =>
    check(
      "axe wcagNNN tags become criteria in numeric order, other tags are ignored",
      JSON.stringify(wcagFromTags(["wcag2aa", "wcag143", "wcag1410", "cat.color", "best-practice"])) === '["1.4.3","1.4.10"]',
      JSON.stringify(wcagFromTags(["wcag2aa", "wcag143", "wcag1410", "cat.color", "best-practice"]))
    )
  );

  const eslintOnly = run("eslint normalize", () =>
    normalizeEslint(
      eslintFile("/repo/apps/web/src/components/Foo.component.tsx", ["jsx-a11y/alt-text", "astro/jsx-a11y/anchor-is-valid", "react/no-unknown-property"]),
      { package: "apps/web", root: "/repo", wcagMap: TEST_MAP }
    )
  );
  check(
    "jsx-a11y rules map to criteria, the astro/ prefix resolves, non-a11y rules are ignored",
    eslintOnly?.length === 2 &&
      eslintOnly[0].rule === "jsx-a11y/alt-text" &&
      eslintOnly[0].wcag.join() === "1.1.1" &&
      eslintOnly[0].location === "apps/web/src/components/Foo.component.tsx:10" &&
      eslintOnly[1].wcag.join() === "2.1.1",
    JSON.stringify(eslintOnly)
  );
  throws(
    "an unmapped jsx-a11y rule fails, naming the rule",
    () => normalizeEslint(eslintFile("/repo/apps/web/src/A.tsx", ["jsx-a11y/made-up-rule"]), { package: "apps/web", root: "/repo", wcagMap: TEST_MAP }),
    /made-up-rule/
  );
  throws(
    "a fatal parse error (no ruleId) fails rather than reading as clean",
    () => normalizeEslint(eslintFile("/repo/apps/web/src/A.tsx", [null]), { package: "apps/web", root: "/repo", wcagMap: TEST_MAP }),
    /parse|fatal/i
  );

  // Owners
  const ownerOf = (finding) => finding?.owner;
  const appInv = run("owner build", () =>
    build([
      {
        input: INPUTS[5],
        data: rawFile("axe-app", [
          appRun("entities-index", 794, [
            violation("region", ["best-practice"]),
            violation("button-name", ["wcag2a", "wcag412"], ["table button"]),
          ]),
        ]),
      },
      {
        input: INPUTS[6],
        data: rawFile("axe-site", [{ context: { route: "/pricing/", theme: "brand" }, status: "ok", violations: [violation("list", ["wcag2a", "wcag131"])] }]),
      },
      {
        input: INPUTS[1],
        data: rawFile("jest-axe", [
          { context: { file: "apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx", story: "Default" }, status: "ok", violations: [violation("aria-roles", ["wcag2a", "wcag412"])] },
          { context: { file: "apps/web/src/components/RenameDialog.component.stories.tsx", story: "Open" }, status: "ok", violations: [violation("label", ["wcag2a", "wcag412"])] },
          { context: { file: "apps/web/src/components/ToastHost.stories.tsx", story: "Stack" }, status: "ok", violations: [violation("aria-roles", ["wcag2a", "wcag412"])] },
        ]),
      },
      {
        input: INPUTS[3],
        data: rawFile("jest-axe", [
          { context: { file: "packages/core/src/ui/DataTable.stories.tsx", story: "Basic" }, status: "ok", violations: [violation("th-has-data-cells", ["wcag2a", "wcag131"])] },
          { context: { file: "packages/core/src/ui/Modal.stories.tsx", story: "Basic" }, status: "ok", violations: [violation("aria-dialog-name", ["wcag2a", "wcag412"])] },
        ]),
      },
      {
        input: INPUTS[0],
        data: [
          ...eslintFile("/r/apps/web/src/modules/MapWidget/MapWidget.component.tsx", ["jsx-a11y/alt-text"]),
          ...eslintFile("/r/apps/web/src/layouts/Authorized.layout.tsx", ["jsx-a11y/anchor-is-valid"]),
        ],
        root: "/r",
      },
    ]).findings
  );
  const byRule = (rule, where = "") => appInv?.find((f) => f.rule === rule && f.location.includes(where));
  check("a shell rule on an app route goes to #797 whatever the route's owner", ownerOf(byRule("region")) === 797, ownerOf(byRule("region")));
  check("an app finding outside the shell rules takes its route's owner", ownerOf(byRule("button-name")) === 794, ownerOf(byRule("button-name")));
  check("every site finding goes to #798", ownerOf(byRule("list")) === 798, ownerOf(byRule("list")));
  check(
    "path prefixes assign RegionEditor, dialogs, tables, modal, maps and layouts",
    ownerOf(byRule("aria-roles", "RegionEditor")) === 795 &&
      ownerOf(byRule("label")) === 793 &&
      ownerOf(byRule("th-has-data-cells")) === 794 &&
      ownerOf(byRule("aria-dialog-name")) === 793 &&
      ownerOf(byRule("jsx-a11y/alt-text")) === 796 &&
      ownerOf(byRule("jsx-a11y/anchor-is-valid")) === 797,
    JSON.stringify(appInv?.map((f) => [f.rule, f.location, f.owner]))
  );
  check("a finding no rule places is unassigned, never guessed", ownerOf(byRule("aria-roles", "ToastHost")) === "unassigned", ownerOf(byRule("aria-roles", "ToastHost")));
  check("a finding with no wcag tag is best practice (no criteria)", byRule("region")?.wcag.length === 0, JSON.stringify(byRule("region")));

  // Dedupe across themes
  const themed = run("theme build", () =>
    build([
      {
        input: INPUTS[5],
        data: rawFile("axe-app", [
          appRun("jobs-index", 794, [violation("button-name", ["wcag412"]), violation("color-contrast", ["wcag143"])], { theme: "brand" }),
          appRun("jobs-index", 794, [violation("button-name", ["wcag412"]), violation("color-contrast", ["wcag143"])], { theme: "brand.dark" }),
          appRun("jobs-index", 794, [violation("button-name", ["wcag412"])], { theme: "brand", role: "member" }),
        ]),
      },
    ]).findings
  );
  const names = themed?.filter((f) => f.rule === "button-name") ?? [];
  check(
    "a non-contrast rule seen in both themes and two roles is one row with every sighting",
    names.length === 1 && names[0].seen.length === 3,
    JSON.stringify(names)
  );
  check(
    "color-contrast keeps one row per theme",
    themed?.filter((f) => f.rule === "color-contrast").length === 2,
    JSON.stringify(themed?.filter((f) => f.rule === "color-contrast"))
  );

  // Failure modes
  throws(
    "an input with no successful run fails, naming the file",
    () => build([{ input: INPUTS[5], data: rawFile("axe-app", [{ context: { route: "x" }, status: "skipped", error: "boom", violations: [] }]) }]),
    /packages\/e2e\/a11y-results\/app\.json/
  );
  throws(
    "an eslint result that linted no files fails, naming the file",
    () => build([{ input: INPUTS[0], data: [] }]),
    /apps\/web\/a11y-results\/eslint\.json/
  );
  throws(
    "a missing input file fails, naming it",
    () => readInputs("/nonexistent-root-for-self-test"),
    /apps\/web\/a11y-results\/eslint\.json/
  );

  // Rendering + marker rewrite
  const inv = run("render build", () =>
    build([
      { input: INPUTS[5], data: rawFile("axe-app", [appRun("entities-index", 794, [violation("button-name", ["wcag412"], ["td | button"])])]) },
      { input: INPUTS[1], data: rawFile("jest-axe", [{ context: { file: "apps/web/src/A.stories.tsx", story: "S" }, status: "skipped", error: "needs MSW", violations: [] }, { context: { file: "apps/web/src/B.stories.tsx", story: "S" }, status: "ok", violations: [] }]) },
    ])
  );
  const manual = run("manual parse", () => parseManual(DOC_FIXTURE));
  check(
    "keyboard and screen-reader rows are counted per owner",
    manual?.[797] === 1 && manual?.[793] === 1 && manual?.[798] === 1,
    JSON.stringify(manual)
  );
  const generated = run("render", () => renderGenerated(inv, manual));
  check(
    "the generated section has the coverage, the summary, an anchored section per owner, and skipped runs with their reason",
    typeof generated === "string" &&
      generated.includes("## Coverage") &&
      generated.includes("## Summary") &&
      Object.keys(OWNERS).every((n) => generated.includes(`<a id="owner-${n}"></a>`)) &&
      generated.includes("needs MSW"),
    generated
  );
  check("a pipe in a CSS target is escaped", generated?.includes("td \\| button"), generated);
  check(
    "the same input renders byte-identically (stable ids, stable order)",
    typeof generated === "string" &&
      generated === run("render again", () => renderGenerated(build([
      { input: INPUTS[5], data: rawFile("axe-app", [appRun("entities-index", 794, [violation("button-name", ["wcag412"], ["td | button"])])]) },
      { input: INPUTS[1], data: rawFile("jest-axe", [{ context: { file: "apps/web/src/A.stories.tsx", story: "S" }, status: "skipped", error: "needs MSW", violations: [] }, { context: { file: "apps/web/src/B.stories.tsx", story: "S" }, status: "ok", violations: [] }]) },
    ]), manual)),
    "output differed between identical runs"
  );
  const rewritten = run("replace", () => replaceGenerated(DOC_FIXTURE, "NEW"));
  check(
    "the rewrite replaces only the marked section; everything outside is byte-identical",
    typeof rewritten === "string" &&
      rewritten.split(START)[0] === DOC_FIXTURE.split(START)[0] &&
      rewritten.split(END)[1] === DOC_FIXTURE.split(END)[1] &&
      rewritten.includes(`${START}\nNEW\n${END}`) &&
      !rewritten.includes("old generated text"),
    rewritten
  );
  throws("a doc with no markers fails", () => replaceGenerated("# no markers\n", "NEW"), /marker/);
  throws("a doc with duplicate markers fails", () => replaceGenerated(`${START}\n${END}\n${START}\n${END}\n`, "NEW"), /marker/);

  // The map covers what the report actually runs: read the installed presets,
  // so a plugin upgrade that adds a rule fails here, not mid-report.
  let enabled;
  try {
    enabled = await enabledJsxA11yRulesAsync();
  } catch (err) {
    check("the installed jsx-a11y presets can be read", false, err.message);
  }
  const unmapped = (enabled ?? []).filter((r) => !JSX_A11Y_WCAG[r]);
  check(
    "every rule the strict presets enable has a WCAG mapping",
    enabled?.length > 0 && unmapped.length === 0,
    `unmapped: ${unmapped.join(", ") || "(no rules read)"}`
  );

  if (failed) {
    console.error(`a11y-inventory self-test: ${failed} of ${total} case(s) failed`);
    process.exit(1);
  }
  console.log(`a11y-inventory self-test: ${total} case(s) passed`);
}

function main() {
  const root = REPO_ROOT;
  try {
    const sources = readInputs(root);
    const docPath = path.join(root, DOC);
    const doc = readFileSync(docPath, "utf8");
    const inventory = buildInventory(sources);
    const next = replaceGenerated(doc, renderGenerated(inventory, parseManual(doc)));
    writeFileSync(docPath, next);
    console.log(`a11y-inventory: ${inventory.findings.length} finding(s) written to ${DOC}`);
  } catch (err) {
    console.error(`a11y-inventory: ${err instanceof InventoryError ? err.message : err.stack ?? err}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) await selfTest();
  else main();
}
