/**
 * Stories accessibility sweep (#792, epic #791), run by `npm run a11y:stories`
 * through `jest.a11y.config.js`; `test:unit` never matches it.
 *
 * Every story in this package is composed, rendered in jsdom through
 * `test-utils`' provider stack, and checked with axe (WCAG 2.2 AA and best
 * practice, minus the rules jsdom can't evaluate). A story that can't load
 * or render is recorded as skipped with its error, so it shows up as a
 * coverage gap instead of disappearing.
 *
 * The story files are dealt round-robin into `STORY_SHARDS` shards, one
 * `stories-<n>.a11y.tsx` each, so Jest sweeps them in parallel workers
 * (#799: one file took ~8 minutes in CI). Each shard writes
 * `a11y-results/stories.shard-<n>.json`, and `scripts/a11y-stories.teardown.mjs`
 * merges them into `a11y-results/stories.json` for
 * `scripts/a11y-inventory.mjs`.
 *
 * Since #799 each shard is a gate. After its results are written it fails
 * on any violation, on any skip not listed in `SKIPPED`, and on a `SKIPPED`
 * entry of its files whose story didn't skip; `gate-helpers.a11y.tsx` fails on an
 * entry whose story file is gone. So the allowlist can't rot.
 * `A11Y_REPORT_ONLY=1` (set by `npm run a11y:report`) records without
 * failing. It also fails when a shard found or rendered nothing: an empty
 * result isn't a clean one.
 */
import type React from "react";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { composeStories } from "@storybook/react";
import jestAxe from "jest-axe";

import { act, cleanup, JSDOM_DISABLED_AXE_RULES, render } from "../test-utils";

export interface RawRun {
  context: { file: string; story: string };
  status: "ok" | "skipped";
  error?: string;
  violations: {
    id: string;
    impact: string | null;
    tags: string[];
    nodes: { target: string[] }[];
  }[];
}

/**
 * Stories the sweep may skip, keyed `"<repo file>#<story>"` (`#*` for a
 * module that fails to load), each with the reason it can't render in jsdom.
 * Empty, and it only shrinks: a new entry needs a reason a reviewer accepts.
 */
export const SKIPPED: Record<string, string> = {};

/** How many `stories-<n>.a11y.tsx` files split the sweep. */
export const STORY_SHARDS = 4;

const runKey = (r: RawRun): string => `${r.context.file}#${r.context.story}`;

/** Each rendered story with violations, with its rule ids. */
export function violatingRuns(runs: RawRun[]): string[] {
  return runs
    .filter((r) => r.status === "ok" && r.violations.length > 0)
    .map((r) => `${runKey(r)}: ${r.violations.map((v) => v.id).join(", ")}`);
}

/** Each skipped story the allowlist doesn't name, with its error. */
export function unlistedSkips(
  runs: RawRun[],
  skipped: Record<string, string>
): string[] {
  return runs
    .filter((r) => r.status === "skipped" && !(runKey(r) in skipped))
    .map((r) => `${runKey(r)}: ${r.error ?? "unknown error"}`);
}

/** Each allowlisted story that didn't skip: it renders now, or is gone. */
export function staleSkips(
  runs: RawRun[],
  skipped: Record<string, string>
): string[] {
  const stillSkipped = new Set(
    runs.filter((r) => r.status === "skipped").map(runKey)
  );
  return Object.keys(skipped).filter((key) => !stillSkipped.has(key));
}

const PACKAGE_DIR = process.cwd();
const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..");

/** Each allowlisted key whose story file isn't among `files` (repo paths).
 *  No shard holds such a file, so no shard's `staleSkips` can see it. */
export function orphanedSkips(
  skipped: Record<string, string>,
  files: string[]
): string[] {
  const known = new Set(files);
  return Object.keys(skipped).filter(
    (key) => !known.has(key.slice(0, key.lastIndexOf("#")))
  );
}

/** Every story file in the package, as a repo path. */
export function repoStoryFiles(): string[] {
  return storyFiles().map((f) =>
    path.relative(REPO_ROOT, f).split(path.sep).join("/")
  );
}
const PACKAGE = path.relative(REPO_ROOT, PACKAGE_DIR);
const RESULTS_DIR = path.join(PACKAGE_DIR, "a11y-results");

// The preview isn't applied: its decorator mounts the real
// ApplicationProvider, whose Auth0 SDK throws in jsdom, and it carries
// nothing else a story renders from. The unit tests' provider stack (fake
// auth, theme, query client, router) stands in for it via `render`.

function storyFiles(): string[] {
  const src = path.join(PACKAGE_DIR, "src");
  return (readdirSync(src, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".stories.tsx"))
    .map((f) => path.join(src, f))
    .sort();
}

/** One line saying why a story couldn't be checked. An error with an empty
 *  message still names its type and where it was thrown. */
function firstLine(err: unknown): string {
  if (!(err instanceof Error))
    return String(err).split("\n")[0] || "unknown error";
  const message = err.message.split("\n")[0];
  if (message) return message;
  const frame = (err.stack ?? "")
    .split("\n")
    .find((l) => l.trim().startsWith("at "));
  return `${err.name || "Error"} with no message${frame ? ` ${frame.trim()}` : ""}`;
}

/** A frame or shadow-DOM target is a path of selectors. Joined exactly as
 *  packages/e2e/src/lib/a11y-record.ts joins it, so the inventory sees one
 *  format from every tool. */
const selector = (t: unknown): string =>
  Array.isArray(t) ? t.map(String).join(" >>> ") : String(t);

const axeRules = Object.fromEntries(
  JSDOM_DISABLED_AXE_RULES.map((id) => [id, { enabled: false }])
);

/** What the sweep needs from a composed story. composeStories' own return
 *  type is generic over the module, so a dynamically imported module
 *  comes back as unknown. */
type SweepStory = React.FC & { load: () => Promise<void> };
type ComposedStories = Record<string, SweepStory>;

/**
 * Defines shard `shard` (1-based) of the sweep. Call it with top-level
 * `await` from the shard's test file: story modules must be imported at
 * module scope, since importing one pulls in @storybook/test, which
 * registers Jest hooks, and Jest refuses a hook registered while a test is
 * running.
 */
export async function defineStorySweep(shard: number): Promise<void> {
  const files = storyFiles().filter((_, i) => i % STORY_SHARDS === shard - 1);
  const modules: {
    file: string;
    stories?: ComposedStories;
    error?: string;
  }[] = [];
  for (const file of files) {
    const repoFile = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    try {
      modules.push({
        file: repoFile,
        stories: composeStories(
          await import(file)
        ) as unknown as ComposedStories,
      });
    } catch (err) {
      modules.push({
        file: repoFile,
        error: `module failed to load: ${firstLine(err)}`,
      });
    }
  }
  const shardFiles = new Set(modules.map((m) => m.file));
  const skipped = Object.fromEntries(
    Object.entries(SKIPPED).filter(([key]) =>
      shardFiles.has(key.slice(0, key.lastIndexOf("#")))
    )
  );
  const results = path.join(RESULTS_DIR, `stories.shard-${shard}.json`);

  it(`sweeps story shard ${shard}/${STORY_SHARDS} with axe`, async () => {
    const runs: RawRun[] = [];
    for (const { file: repoFile, stories, error } of modules) {
      if (!stories) {
        runs.push({
          context: { file: repoFile, story: "*" },
          status: "skipped",
          error,
          violations: [],
        });
        continue;
      }
      for (const [name, Story] of Object.entries(stories)) {
        const context = { file: repoFile, story: name };
        try {
          await Story.load();
          const { baseElement } = render(<Story />);
          // Let mount effects and microtasks settle before measuring.
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          const results = await jestAxe.axe(baseElement, { rules: axeRules });
          runs.push({
            context,
            status: "ok",
            violations: results.violations.map((v) => ({
              id: v.id,
              impact: v.impact ?? null,
              tags: v.tags,
              nodes: v.nodes.map((n) => ({ target: n.target.map(selector) })),
            })),
          });
        } catch (err) {
          runs.push({
            context,
            status: "skipped",
            error: firstLine(err),
            violations: [],
          });
        } finally {
          cleanup();
        }
      }
    }

    const require = createRequire(import.meta.url);
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(
      results,
      `${JSON.stringify(
        {
          tool: "jest-axe",
          package: PACKAGE,
          generatedAt: new Date().toISOString(),
          axeVersion: require("axe-core/package.json").version,
          runs,
        },
        null,
        2
      )}\n`
    );

    const ok = runs.filter((r) => r.status === "ok").length;
    console.log(
      `a11y:stories shard ${shard}: ${ok} story render(s) checked, ${runs.length - ok} skipped → ${path.relative(REPO_ROOT, results)}`
    );
    expect(runs.length).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(0);
    if (process.env.A11Y_REPORT_ONLY === "1") return;
    // One assertion, so a failing run lists every problem at once.
    expect({
      violating: violatingRuns(runs),
      unlistedSkips: unlistedSkips(runs, skipped),
      staleSkips: staleSkips(runs, skipped),
    }).toEqual({ violating: [], unlistedSkips: [], staleSkips: [] });
  });
}
