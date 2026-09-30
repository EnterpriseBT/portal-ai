#!/usr/bin/env node
/**
 * Decides whether the Integration Tests job runs the suite or skips it as a
 * docs-only change (#663).
 *
 * The skip used to diff against the previous push (`github.event.before`).
 * That's only sound if the previous push's run passed with the suite, and
 * two ordinary sequences broke it:
 *   - a code push whose run was CANCELLED by the next push (cancel-in-progress),
 *     then a docs-only push: green, and the code was never integration-tested;
 *   - a code push whose run FAILED, then a docs-only push: green on head, and
 *     the red suite is masked (branch protection reads head).
 *
 * The base is now the head commit of this branch's newest SUCCESSFUL
 * Integration Tests run that is an ancestor of HEAD. Cancelled and failed runs
 * are never a base. By induction a successful skip is as good as a real pass:
 * it was itself justified by an earlier green run with only docs in between.
 * Any doubt runs the suite.
 *
 * Usage:
 *   node scripts/integration-skip-base.mjs --self-test   (npm run lint:integration-skip)
 *   node scripts/integration-skip-base.mjs               (the workflow step; writes
 *        run= / reason= / base= to $GITHUB_OUTPUT)
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** A path that cannot affect the integration suite. */
const DOCS_ONLY = /^docs\/|\.md$/;

/**
 * Pure decision.
 * @param {object} p
 * @param {string} p.event         GITHUB_EVENT_NAME
 * @param {string} p.head          the commit under test
 * @param {string[] | null} p.successfulShas  head SHAs of this branch's successful
 *                                 runs, newest first; null when the lookup failed
 * @param {(sha: string, head: string) => boolean} p.isAncestor
 * @param {(base: string, head: string) => string[] | null} p.changedFiles  null on failure
 * @returns {{ run: boolean, reason: string, base: string | null }}
 */
export function decideIntegrationRun(p) {
  const run = (reason, base = null) => ({ run: true, reason, base });

  // Only a push has a branch history to compare. workflow_call (the
  // deploy-dev dispatch) and anything else always run.
  if (p.event !== "push") return run(`event ${p.event || "(none)"} is not a push`);
  if (!p.head) return run("no head SHA");
  if (p.successfulShas === null) return run("run history unavailable");

  const base = p.successfulShas.find((sha) => p.isAncestor(sha, p.head)) ?? null;
  if (!base) return run("no successful run on this branch is an ancestor of HEAD");

  const changed = p.changedFiles(base, p.head);
  if (changed === null) return run(`diff from ${base} failed`, base);
  if (changed.length === 0) return run(`nothing changed since ${base}`, base);
  if (changed.some((f) => !DOCS_ONLY.test(f))) {
    return run(`code changed since ${base} (the last green run)`, base);
  }
  return {
    run: false,
    reason: `docs-only since ${base} (the last green run): ${changed.join(", ")}`,
    base,
  };
}

// ── Self-test ───────────────────────────────────────────────────────────────
// A linear history G0 → C1 → D2 → D3, where G0 had a green run. `changes`
// lists the files each commit touched; changedFiles unions the range.
function fixture(history, changes, extra = {}) {
  const idx = (s) => history.indexOf(s);
  return {
    event: "push",
    head: history[history.length - 1],
    isAncestor: (sha, head) => idx(sha) !== -1 && idx(sha) <= idx(head),
    changedFiles: (base, head) =>
      history.slice(idx(base) + 1, idx(head) + 1).flatMap((s) => changes[s] ?? []),
    ...extra,
  };
}

const CASES = [
  {
    name: "green run, then a docs-only push: skip",
    input: fixture(["G0", "D1"], { D1: ["docs/X.smoke.md"] }, { successfulShas: ["G0"] }),
    expect: { run: false, base: "G0" },
  },
  {
    name: "green → code (run cancelled) → docs-only: run, the code is in range",
    input: fixture(
      ["G0", "C1", "D2"],
      { C1: ["apps/api/src/x.ts"], D2: ["docs/X.adversarial.md"] },
      { successfulShas: ["G0"] }
    ),
    expect: { run: true, base: "G0" },
  },
  {
    name: "green → code (run failed) → docs-only: run, never green over a red suite",
    input: fixture(
      ["G0", "C1", "D2"],
      { C1: ["apps/api/src/x.ts"], D2: ["README.md"] },
      // C1 failed, so only G0 is in the success list.
      { successfulShas: ["G0"] }
    ),
    expect: { run: true, base: "G0" },
  },
  {
    name: "no successful run on the branch yet: run",
    input: fixture(["C0", "D1"], { D1: ["docs/a.md"] }, { successfulShas: [] }),
    expect: { run: true, base: null },
  },
  {
    name: "the only green run isn't an ancestor (force-push): run",
    input: fixture(["N0", "D1"], { D1: ["docs/a.md"] }, { successfulShas: ["OLD"] }),
    expect: { run: true, base: null },
  },
  {
    name: "workflow_call (deploy-dev dispatch): run",
    input: fixture(["G0", "D1"], { D1: ["docs/a.md"] }, { successfulShas: ["G0"], event: "workflow_call" }),
    expect: { run: true },
  },
  {
    name: "green run, then a code push: run",
    input: fixture(["G0", "C1"], { C1: ["apps/api/src/x.ts"] }, { successfulShas: ["G0"] }),
    expect: { run: true, base: "G0" },
  },
  {
    name: "run-history lookup failed: run",
    input: fixture(["G0", "D1"], { D1: ["docs/a.md"] }, { successfulShas: null }),
    expect: { run: true, base: null },
  },
  {
    name: "newest green is an earlier skip that's still an ancestor: skip from it",
    input: fixture(
      ["G0", "D1", "D2"],
      { D1: ["docs/a.md"], D2: ["docs/b.md"] },
      { successfulShas: ["D1", "G0"] }
    ),
    expect: { run: false, base: "D1" },
  },
  {
    name: "a re-run of an already-green head (empty range): run",
    input: fixture(["G0"], {}, { successfulShas: ["G0"] }),
    expect: { run: true },
  },
];

function selfTest() {
  let failed = 0;
  for (const c of CASES) {
    let got;
    try {
      got = decideIntegrationRun(c.input);
    } catch (err) {
      got = { error: String(err.message ?? err) };
    }
    const ok =
      !("error" in got) &&
      got.run === c.expect.run &&
      (!("base" in c.expect) || got.base === c.expect.base) &&
      typeof got.reason === "string" &&
      got.reason.length > 0;
    console.log(`${ok ? "✓" : "✗"} ${c.name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
    if (!ok) failed += 1;
  }
  if (failed) {
    console.error(`integration-skip self-test: ${failed} of ${CASES.length} case(s) failed`);
    process.exit(1);
  }
  console.log(`integration-skip self-test: ${CASES.length} case(s) passed`);
}

// ── Workflow entrypoint ─────────────────────────────────────────────────────
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function successfulShas() {
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_REF_NAME;
  if (!repo || !branch) return null;
  try {
    const out = execFileSync(
      "gh",
      [
        "api",
        `repos/${repo}/actions/workflows/integration-test.yml/runs?branch=${encodeURIComponent(branch)}&status=success&per_page=30`,
        "--jq",
        ".workflow_runs[].head_sha",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.log(`run-history lookup failed: ${String(err.message ?? err).split("\n")[0]}`);
    return null;
  }
}

function main() {
  const decision = decideIntegrationRun({
    event: process.env.GITHUB_EVENT_NAME ?? "",
    head: process.env.GITHUB_SHA ?? "",
    successfulShas: successfulShas(),
    isAncestor: (sha, head) => {
      try {
        git(["merge-base", "--is-ancestor", sha, head]);
        return true;
      } catch {
        return false;
      }
    },
    changedFiles: (base, head) => {
      try {
        return git(["diff", "--name-only", base, head]).split("\n").filter(Boolean);
      } catch {
        return null;
      }
    },
  });
  const verdict = decision.run ? "running the suite" : "skipping the integration suite";
  console.log(`${decision.reason} — ${verdict}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `run=${decision.run}\nreason=${decision.reason}\nbase=${decision.base ?? ""}\n`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
