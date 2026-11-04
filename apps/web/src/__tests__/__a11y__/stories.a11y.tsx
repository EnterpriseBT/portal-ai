/**
 * Stories accessibility sweep (#792, epic #791). Run by `npm run a11y:stories`
 * through `jest.a11y.config.js`; `test:unit` never matches this file.
 *
 * Every story in this package is composed, rendered in jsdom through
 * `test-utils`' provider stack, and checked with axe (WCAG 2.2 AA and best
 * practice, minus the rules jsdom can't evaluate). Violations are recorded
 * in `a11y-results/stories.json` for `scripts/a11y-inventory.mjs`, never
 * asserted. A story that can't load or render is recorded as skipped with
 * its error, so it shows up as a coverage gap instead of disappearing. The
 * one assertion is that the sweep found and rendered something: an empty
 * result isn't a clean one.
 */
import type React from "react";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { composeStories } from "@storybook/react";
import jestAxe from "jest-axe";

import { act, cleanup, JSDOM_DISABLED_AXE_RULES, render } from "../test-utils";

interface RawRun {
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

const PACKAGE_DIR = process.cwd();
const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..");
const PACKAGE = path.relative(REPO_ROOT, PACKAGE_DIR);
const RESULTS = path.join(PACKAGE_DIR, "a11y-results", "stories.json");

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

const axeRules = Object.fromEntries(
  JSDOM_DISABLED_AXE_RULES.map((id) => [id, { enabled: false }])
);

/** What the sweep needs from a composed story. composeStories' own return
 *  type is generic over the module, so a dynamically imported module
 *  comes back as unknown. */
type SweepStory = React.FC & { load: () => Promise<void> };
type ComposedStories = Record<string, SweepStory>;

// Story modules are imported here, at module scope, not inside the test:
// importing one pulls in @storybook/test, which registers Jest hooks, and
// Jest refuses a hook registered while a test is running.
const modules: { file: string; stories?: ComposedStories; error?: string }[] =
  [];
for (const file of storyFiles()) {
  const repoFile = path.relative(REPO_ROOT, file).split(path.sep).join("/");
  try {
    modules.push({
      file: repoFile,
      stories: composeStories(await import(file)) as unknown as ComposedStories,
    });
  } catch (err) {
    modules.push({
      file: repoFile,
      error: `module failed to load: ${firstLine(err)}`,
    });
  }
}

it("sweeps every story with axe", async () => {
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
            nodes: v.nodes.map((n) => ({ target: n.target.map(String) })),
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
  mkdirSync(path.dirname(RESULTS), { recursive: true });
  writeFileSync(
    RESULTS,
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
    `a11y:stories: ${ok} story render(s) checked, ${runs.length - ok} skipped → ${path.relative(REPO_ROOT, RESULTS)}`
  );
  expect(runs.length).toBeGreaterThan(0);
  expect(ok).toBeGreaterThan(0);
});
