#!/usr/bin/env node
/**
 * Fails when the CI remote-cache wiring is missing, or when a load-bearing CI
 * invariant drifts (#454).
 *
 * Why this exists: Turborepo's remote cache degrades **silently**. A workflow
 * that runs turbo without `TURBO_TOKEN`/`TURBO_TEAM` caches nothing and still
 * reports success, so the regression is invisible in the diff *and* in the
 * check result — you only notice it as CI being mysteriously slow again. The
 * invariants this ticket had to preserve fail the same quiet way: renaming a
 * required-check job un-gates it on `main` and then wedges every PR forever
 * on a context that never reports. None of it had a test before this script.
 *
 * CI configuration has no natural unit-test surface, so the rules are
 * exercised against embedded synthetic fixtures on every run, and then
 * against the real tree. `--self-test` runs only the fixtures.
 *
 * YAML note: parsed with `yaml` (1.2 core schema), deliberately **not**
 * `js-yaml`. Under YAML 1.1 the `on:` key parses as boolean `true`, which
 * silently breaks any rule that reads a workflow's triggers.
 *
 * Rules land slice by slice, each with the change that satisfies it — see
 * `docs/TURBOREPO_CI_CACHING.plan.md`:
 *   - rule 3: required-check job names are exactly the three gated on `main`,
 *     and a sharded check's name sits on the aggregator over its shards (#857)
 *   - rule 4: those workflows' `concurrency.group` leads with a literal
 *   - rule 5: `apps/site`'s build stays uncached, with its env declared
 *   - rule 1: a workflow that runs turbo carries the cache credentials
 *   - rule 2: a workflow_call site passes every secret the callee declares
 *   - rule 6: each sharded suite's shard var is in its turbo task's hash
 *     (#857, #1091), so one shard can never restore another shard's cached
 *     result
 *   - rule 7: every job pins its runner image, never a floating `*-latest`
 *     label (#904)
 *   - rule 8: one push's peak concurrent jobs, with each shard matrix at its
 *     suite's cap, stay within GitHub Free's 20 (#1091)
 *
 * Usage: npm run lint:ci-cache [-- --self-test]
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { parse as parseJsonc } from "jsonc-parser";

import { CONCURRENT_JOB_LIMIT, SUITES } from "./test-shards.lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

/**
 * The three checks required on `main`. The KEY is the workflow filename; the
 * VALUE is the exact job `name:` GitHub matches as a status context. Renaming
 * a job silently un-gates it, so these strings are a contract, not a label.
 */
const REQUIRED_CHECK_JOB_NAMES = {
  "unit-test.yml": "Unit Tests",
  "integration-test.yml": "Integration Tests",
  "static-checks.yml": "Static Checks",
};

/** The three vars every turbo invocation in CI needs. */
const CACHE_ENV_VARS = ["TURBO_TOKEN", "TURBO_TEAM", "TURBO_REMOTE_CACHE_SIGNATURE_KEY"];

/**
 * Workflows that run turbo but have NOT opted into the remote cache.
 *
 * EMPTY, and meant to stay that way. It briefly held the three deploy
 * workflows so rule 1 could land with the suites (#454 slice 4) without making
 * the gate red at that boundary; slice 6 opted them in and emptied it. Adding a
 * name here silently gives up caching for that workflow, so treat it as a
 * last resort with a dated reason, not a convenient escape hatch.
 */
const PENDING_CACHE_OPT_IN = new Set([]);

/** Env keys declared on a workflow/job/step, or [] when absent. */
function envKeys(env) {
  return env && typeof env === "object" && !Array.isArray(env) ? Object.keys(env) : [];
}

/**
 * Does this `run:` invoke turbo — directly, or through a root npm script that
 * is a turbo passthrough? `npm run lint:doc-pointers` must NOT match `lint`,
 * so script names are compared as whole tokens.
 */
function invokesTurbo(run, turboScripts) {
  if (typeof run !== "string") return false;
  if (/\bturbo\s+run\b/.test(run)) return true;
  return [...run.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_.-]+)/g)].some((m) =>
    turboScripts.includes(m[1])
  );
}

/**
 * Finds every rule violation. Pure: takes already-parsed inputs, touches no
 * filesystem, so the fixtures below and the real tree run through the exact
 * same code path.
 *
 * `siteTurbo` distinguishes three states deliberately: `undefined` means the
 * caller is not exercising rule 5 (so a rules-3/4 fixture stays focused),
 * `null` means the file is genuinely absent, and an object is its parsed
 * contents.
 *
 * `turboScripts` is the set of root npm scripts that are turbo passthroughs,
 * passed in rather than read from package.json so this stays pure and cannot
 * drift from the real script list.
 *
 * `turboFiles` maps a turbo.json path (`turbo.json`, `apps/web/turbo.json`)
 * to its parsed contents, or null when absent. `undefined` skips rule 6.
 *
 * @param {{workflows?: Array<{file: string, doc: any}>, siteTurbo?: any, turboFiles?: Record<string, any>, turboScripts?: string[]}} input
 * @returns {Array<{rule: number, file: string, message: string}>}
 */
export function findViolations({ workflows = [], siteTurbo, turboFiles, turboScripts = [] } = {}) {
  const violations = [];

  for (const { file, doc } of workflows) {
    const expectedJobName = REQUIRED_CHECK_JOB_NAMES[file];
    if (!expectedJobName) continue;

    // Rule 3 — the job name IS the status-check context GitHub matches.
    const jobNames = Object.values(doc?.jobs ?? {})
      .map((job) => job?.name)
      .filter((name) => typeof name === "string");

    if (!jobNames.includes(expectedJobName)) {
      violations.push({
        rule: 3,
        file,
        message:
          `no job is named "${expectedJobName}". That exact string is a required ` +
          `status check on main: renaming it un-gates the check and then wedges ` +
          `every PR waiting for a context that never reports. Found ` +
          `${jobNames.length ? jobNames.map((n) => `"${n}"`).join(", ") : "no named jobs"}.`,
      });
    }

    // Rule 3, sharded (#857) — when the check runs as a matrix, the job that
    // carries the required name must be the aggregator over it. A matrix job
    // can't be that job: each leg reports its own context, so the required
    // name would match one leg, or none. And an aggregator that doesn't wait
    // for every leg, or that GitHub skips when a leg fails (no `always()`),
    // reports green — or nothing — over a red shard.
    const jobs = Object.entries(doc?.jobs ?? {});
    const matrixJobs = jobs.filter(([, job]) => job?.strategy?.matrix).map(([id]) => id);
    if (matrixJobs.length) {
      const named = jobs.find(([, job]) => job?.name === expectedJobName);
      const problems = [];
      if (named) {
        const [id, job] = named;
        const needs = [].concat(job.needs ?? []);
        if (matrixJobs.includes(id)) problems.push(`"${expectedJobName}" is itself the matrix job`);
        // `always()` or `!cancelled()`: both run when a shard fails. The
        // latter also stands down when the run itself is cancelled (a newer
        // push superseded it), rather than posting red on the old commit.
        const gate = String(job.if ?? "");
        if (!gate.includes("always()") && !gate.includes("!cancelled()")) {
          problems.push(
            `its \`if\` has neither always() nor !cancelled(), so GitHub skips it when a shard fails`
          );
        }
        const missing = matrixJobs.filter((m) => m !== id && !needs.includes(m));
        if (missing.length) problems.push(`its \`needs\` omits the matrix job(s) ${missing.join(", ")}`);
      }
      if (problems.length) {
        violations.push({
          rule: 3,
          file,
          message:
            `the required check "${expectedJobName}" runs as a matrix, so the job with ` +
            `that name must be a summary that needs every shard, gated on always() or !cancelled(): ` +
            `${problems.join("; ")}.`,
        });
      }
    }

    // Rule 4 — the group must lead with a LITERAL. Inside a workflow_call every
    // `github.*` context resolves to the CALLER, so a group leading with
    // `github.workflow` makes all three suites invoked from one deploy run share
    // a group and cancel each other.
    const concurrency = doc?.concurrency;
    const group = typeof concurrency === "string" ? concurrency : concurrency?.group;

    if (typeof group !== "string" || group.trim() === "") {
      violations.push({
        rule: 4,
        file,
        message:
          "no concurrency.group. These workflows rely on a per-branch group to " +
          "cancel superseded runs; without one an amended commit pays for a full " +
          "cycle on a dead SHA.",
      });
    } else if (group.trimStart().startsWith("${{")) {
      violations.push({
        rule: 4,
        file,
        message:
          `concurrency.group leads with an expression (${JSON.stringify(group)}), not a ` +
          `literal. Inside a workflow_call, github.* resolves to the CALLER, so the ` +
          `three suites in one deploy run would share a group and cancel each other. ` +
          `Lead with the literal workflow name instead.`,
      });
    }
  }

  // Rule 1 — a workflow that runs turbo must carry the cache credentials.
  //
  // The failure is silent: without them turbo caches nothing, reports success,
  // and CI is simply slow again. Nothing in the diff or the check result says
  // so. TURBO_REMOTE_CACHE_SIGNATURE_KEY is required alongside the token
  // because turbo.json sets `remoteCache.signature`.
  for (const { file, doc } of workflows) {
    if (PENDING_CACHE_OPT_IN.has(file)) continue;

    const workflowEnv = envKeys(doc?.env);

    for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
      const jobEnv = envKeys(job?.env);

      // One report per JOB, not per step: several steps in a job typically run
      // turbo and the remedy is a single env block, so per-step reporting would
      // just repeat the same instruction.
      for (const step of job?.steps ?? []) {
        if (!invokesTurbo(step?.run, turboScripts)) continue;

        const available = new Set([...workflowEnv, ...jobEnv, ...envKeys(step?.env)]);
        const missing = CACHE_ENV_VARS.filter((v) => !available.has(v));

        if (missing.length) {
          violations.push({
            rule: 1,
            file,
            message:
              `job "${jobId}" runs turbo but ${missing.join(", ")} ` +
              `${missing.length === 1 ? "is" : "are"} not in scope. Without the ` +
              `credentials turbo silently caches nothing and still reports success.`,
          });
          break;
        }
      }
    }
  }

  // Rule 2 — a workflow_call site must pass every secret the callee declares.
  //
  // Inside a reusable workflow, an unpassed secret is simply empty. Combined
  // with rule 1's silent-degradation property that means a deploy run can look
  // entirely healthy while caching nothing. Declared-but-unpassed is checked
  // regardless of `required:`, because `required: false` exists so a
  // push-triggered run (which has no caller) stays legal — it is not licence
  // for a caller to omit it.
  const docByFile = new Map(workflows.map((w) => [w.file, w.doc]));

  for (const { file, doc } of workflows) {
    for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
      const localCall = typeof job?.uses === "string" && job.uses.match(/^\.\/\.github\/workflows\/(.+)$/);
      if (!localCall) continue;

      const calleeDoc = docByFile.get(localCall[1]);
      if (!calleeDoc) continue; // callee outside the provided set — nothing to compare

      const declared = Object.keys(calleeDoc?.on?.workflow_call?.secrets ?? {});
      if (declared.length === 0) continue;
      if (job.secrets === "inherit") continue;

      const passed = envKeys(job?.secrets);
      const missing = declared.filter((d) => !passed.includes(d));

      if (missing.length) {
        violations.push({
          rule: 2,
          file,
          message:
            `job "${jobId}" calls ${localCall[1]} without passing ${missing.join(", ")}. ` +
            `An unpassed secret is empty inside the callee, so the run looks healthy ` +
            `while doing nothing. Pass it explicitly, or use \`secrets: inherit\`.`,
        });
      }
    }
  }

  // Rule 5 — `apps/site`'s build must stay uncached, with its env declared.
  //
  // Its output is a function of a live `GET /api/public/site-config` fetch that
  // bakes prices into static HTML, so a byte-identical source tree can still
  // need a fresh build. `cache: false` has been the answer since Aug 2026.
  //
  // Why this needs a GUARD rather than just a comment: those vars are declared
  // under `passThroughEnv`, which passes them to the build while deliberately
  // keeping them OUT of the task hash. Measured on #454 — a sentinel SITE_URL
  // landed in dist/index.html while the hash did not move. That is safe only
  // while nothing caches. Anyone who flips `cache: true` (a reasonable-looking
  // "why isn't this cached?" edit) reopens a cross-environment bleed in which
  // a prod deploy can restore dev's artifact, with no other signal that it
  // happened. This rule is that signal.
  if (siteTurbo !== undefined) {
    const build = siteTurbo?.tasks?.build;

    if (!siteTurbo || !build) {
      violations.push({
        rule: 5,
        file: SITE_TURBO_PATH,
        message:
          "missing, or declares no `build` task. apps/site's build must be " +
          "explicitly uncached — its output depends on a live price fetch.",
      });
    } else {
      if (build.cache !== false) {
        violations.push({
          rule: 5,
          file: SITE_TURBO_PATH,
          message:
            `build.cache is ${JSON.stringify(build.cache)}, expected false. Its ` +
            `output depends on a live site-config fetch, and its env is invisible ` +
            `to the task hash — caching it lets a prod deploy restore dev's artifact.`,
        });
      }

      const declared = [
        ...(Array.isArray(build.env) ? build.env : []),
        ...(Array.isArray(build.passThroughEnv) ? build.passThroughEnv : []),
      ];

      if (declared.length === 0) {
        violations.push({
          rule: 5,
          file: SITE_TURBO_PATH,
          message:
            "neither build.env nor build.passThroughEnv declares anything. Under " +
            "the default strict envMode an undeclared var never reaches the build " +
            "at all, so the site would silently render its fallback values.",
        });
      }
    }
  }

  // Rule 6 — each sharded suite's shard var must be in its turbo task's hash.
  //
  // Each shard runs a different slice of the suite, but every shard runs the
  // same task over the same inputs. The shard var is the only thing that
  // tells their results apart, so if it isn't hashed, every shard shares one
  // cache entry: the first shard to finish caches a "pass", and the rest
  // restore it without running their own files (#857). `passThroughEnv` is
  // exactly that failure: the var reaches Jest, but not the hash. The suites,
  // their vars and the turbo task that must hash each come from
  // scripts/test-shards.lib.mjs (#1091).
  if (turboFiles !== undefined) {
    for (const suite of Object.values(SUITES)) {
      const setter = workflows.find(({ doc }) => setsEnvVar(doc, suite.shardVar));
      if (!setter) continue;
      const turbo = turboFiles[suite.turboFile];
      const task = turbo?.tasks?.[suite.turboTask];
      const env = Array.isArray(task?.env) ? task.env : [];
      const passThrough = Array.isArray(task?.passThroughEnv) ? task.passThroughEnv : [];
      if (!env.includes(suite.shardVar) || passThrough.includes(suite.shardVar)) {
        violations.push({
          rule: 6,
          file: suite.turboFile,
          message:
            `${setter.file} sets ${suite.shardVar}, but ${suite.turboFile}'s ${suite.turboTask} ` +
            `must list it in \`env\` (hashed) and not in \`passThroughEnv\`` +
            `${turbo ? "" : " (the file is missing or unparseable)"}. ` +
            `Otherwise every shard shares one cache entry and restores another ` +
            `shard's result without running its own files.`,
        });
      }
    }
  }

  // Rule 7 — every job pins its runner image (#904).
  //
  // `ubuntu-latest` moves to a new OS on GitHub's schedule, not ours: the
  // toolchain every job (and the deploy's aws CLI, zip, buildx) depends on
  // changes with no commit to review, and each migration warns on every job.
  // A pinned image makes the next move a one-line, reviewed change.
  for (const { file, doc } of workflows) {
    for (const [id, job] of Object.entries(doc?.jobs ?? {})) {
      const labels = [job?.["runs-on"]].flat().filter((l) => typeof l === "string");
      const floating = labels.filter((l) => /-latest$/.test(l));
      if (floating.length) {
        violations.push({
          rule: 7,
          file,
          message:
            `job "${id}" runs on ${floating.join(", ")}. Pin the image ` +
            `(e.g. ubuntu-26.04) so an OS move is a reviewed change.`,
        });
      }
    }
  }

  // Rule 8 — one push stays within GitHub Free's concurrent-job limit (#1091).
  //
  // The limit is per account and shared by every workflow and PR, and a job
  // over it queues rather than fails: nothing ever turns red, CI just gets
  // slower. So the budget lives here, computed from the YAML and each
  // suite's shard cap, and a new push workflow, a new job, or a raised cap
  // fails until the total fits.
  const { total, peaks, problems } = pushConcurrency(workflows);
  for (const problem of problems) violations.push({ rule: 8, ...problem });
  if (total > CONCURRENT_JOB_LIMIT) {
    violations.push({
      rule: 8,
      file: peaks.map((p) => p.file).join(", "),
      message:
        `one push can run ${total} jobs at once, over GitHub Free's ${CONCURRENT_JOB_LIMIT} ` +
        `(${peaks.map((p) => `${p.file} ${p.peak}`).join(", ")}). Lower a suite's maxShards in ` +
        `scripts/test-shards.lib.mjs, or fold a job into another, until it fits.`,
    });
  }

  return violations;
}

/** Whether a push to a branch other than main starts this workflow. */
function startsOnBranchPush(doc) {
  const on = doc?.on;
  if (on === "push") return true;
  if (Array.isArray(on)) return on.includes("push");
  if (!on || typeof on !== "object" || !("push" in on)) return false;
  const branches = on.push?.branches;
  return !(Array.isArray(branches) && branches.length === 1 && branches[0] === "main");
}

/**
 * A job's weight in concurrent runners: 1, or its matrix's leg count. A
 * dynamic matrix is bounded only when a `test-shards.mjs plan --suite <s>`
 * step in the job it reads planned it, and then weighs that suite's cap.
 * Anything else can't be bounded and is reported.
 */
function jobWeight(jobs, id) {
  const matrix = jobs[id]?.strategy?.matrix;
  if (matrix === undefined) return { weight: 1 };
  if (typeof matrix === "string") {
    const source = /needs\.([\w-]+)\.outputs\.matrix/.exec(matrix)?.[1];
    const steps = source ? (jobs[source]?.steps ?? []) : [];
    const suiteKey = steps
      .map((step) => /test-shards\.mjs\s+plan\b.*--suite\s+([\w-]+)/.exec(String(step?.run ?? ""))?.[1])
      .find(Boolean);
    const suite = suiteKey ? SUITES[suiteKey] : undefined;
    if (suite) return { weight: suite.maxShards };
    return {
      weight: 1,
      problem:
        `job "${id}" has a dynamic matrix that no \`test-shards.mjs plan --suite <suite>\` step ` +
        `plans, so its size is unbounded and the concurrency budget can't count it`,
    };
  }
  if (typeof matrix !== "object" || "include" in matrix || "exclude" in matrix) {
    return { weight: 1, problem: `job "${id}" has a matrix this rule can't size (include/exclude or a non-list value)` };
  }
  let weight = 1;
  for (const [key, values] of Object.entries(matrix)) {
    if (!Array.isArray(values)) {
      return { weight: 1, problem: `job "${id}"'s matrix key "${key}" isn't a literal list` };
    }
    weight *= values.length;
  }
  return { weight };
}

/**
 * A workflow's peak concurrent jobs: the heaviest set of jobs with no
 * `needs` path, direct or transitive, between any two (only those can run
 * at once). Brute force over subsets; past 16 jobs, the total weight.
 */
function workflowPeak(doc) {
  const jobs = doc?.jobs ?? {};
  const ids = Object.keys(jobs);
  const problems = [];
  const weights = ids.map((id) => {
    const { weight, problem } = jobWeight(jobs, id);
    if (problem) problems.push(problem);
    return weight;
  });
  const needs = (id) => [].concat(jobs[id]?.needs ?? []);
  const reaches = (from, to, seen = new Set()) =>
    needs(from).some((n) => n === to || (!seen.has(n) && (seen.add(n), reaches(n, to, seen))));
  const ordered = (a, b) => reaches(ids[a], ids[b]) || reaches(ids[b], ids[a]);
  if (ids.length > 16) return { peak: weights.reduce((n, w) => n + w, 0), problems };
  let peak = 0;
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const members = ids.map((_, i) => i).filter((i) => mask & (1 << i));
    if (members.some((a, x) => members.slice(x + 1).some((b) => ordered(a, b)))) continue;
    peak = Math.max(peak, members.reduce((n, i) => n + weights[i], 0));
  }
  return { peak, problems };
}

/**
 * The peak concurrent jobs one branch push can start, summed over every
 * workflow it triggers.
 * @returns {{total: number, peaks: Array<{file: string, peak: number}>, problems: Array<{file: string, message: string}>}}
 */
export function pushConcurrency(workflows) {
  const peaks = [];
  const problems = [];
  for (const { file, doc } of workflows) {
    if (!startsOnBranchPush(doc)) continue;
    const { peak, problems: found } = workflowPeak(doc);
    peaks.push({ file, peak });
    for (const message of found) problems.push({ file, message });
  }
  return { total: peaks.reduce((n, p) => n + p.peak, 0), peaks, problems };
}

/** Whether a workflow sets `name` in its workflow, job or step env. */
function setsEnvVar(doc, name) {
  const has = (env) => env && typeof env === "object" && name in env;
  if (has(doc?.env)) return true;
  return Object.values(doc?.jobs ?? {}).some(
    (job) => has(job?.env) || (job?.steps ?? []).some((step) => has(step?.env))
  );
}

// ---------------------------------------------------------------------------
// Fixtures — synthetic workflows asserting the RULE, not today's config.
// ---------------------------------------------------------------------------

const cleanConcurrency = (prefix) => `
concurrency:
  group: "${prefix}-\${{ github.ref }}-\${{ github.run_id }}"
  cancel-in-progress: true
`;

const staticChecks = ({ jobName = "Static Checks", concurrency = cleanConcurrency("static-checks") } = {}) => `
name: Static Checks
on:
  push:
    branches-ignore:
      - main
  workflow_call:
${concurrency}
jobs:
  static-checks:
    name: ${jobName}
    runs-on: ubuntu-26.04
    steps:
      - name: Lint
        run: npm run lint
`;

const unitTest = ({ concurrency = cleanConcurrency("unit-test") } = {}) => `
name: Unit Tests
on:
  push:
    branches-ignore:
      - main
  workflow_call:
${concurrency}
jobs:
  test-unit:
    name: Unit Tests
    runs-on: ubuntu-26.04
    steps:
      - name: Run unit tests
        run: npm run test:unit
`;

const CACHE_ENV = `
env:
  TURBO_TOKEN: \${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: \${{ vars.TURBO_TEAM }}
  TURBO_REMOTE_CACHE_SIGNATURE_KEY: \${{ secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY }}
`;

const runsTurbo = ({ env = "", command = "npx turbo run build" } = {}) => `
name: Some Workflow
on:
  push: {}
${env}
jobs:
  work:
    runs-on: ubuntu-26.04
    steps:
      - name: Do it
        run: ${command}
`;

const calleeDeclaring = (secretName) => `
name: Callee
on:
  workflow_call:
    secrets:
      ${secretName}:
        required: false
jobs:
  work:
    runs-on: ubuntu-26.04
    steps:
      - run: echo hi
`;

const callerPassing = (mapping) => `
name: Caller
on:
  workflow_dispatch: {}
jobs:
  call-it:
    uses: ./.github/workflows/callee.yml
${mapping}
`;

const SITE_TURBO_PATH = "apps/site/turbo.json";

const siteTurbo = (build) => ({ extends: ["//"], tasks: { build } });

const SITE_ENV = ["SITE_URL", "SITE_CONFIG_URL"];

// Rule 6 fixtures: a job that sets the shard var, and a root turbo.json.
const setsShard = () => `
name: Shards
on: push
jobs:
  shard:
    runs-on: ubuntu-26.04
    steps:
      - run: npm run test:integration
        env:
          INTEGRATION_SHARD: "\${{ matrix.index }}/5"
`;

// A turboFiles map holding only the root turbo.json's test:integration.
const rootTurbo = (task) => ({ "turbo.json": { tasks: { "test:integration": task } } });

// Rule 6 (#1091): the web unit suite's shard var, hashed by apps/web's own
// turbo.json.
const setsWebShard = () => `
name: Web shards
on: workflow_dispatch
jobs:
  web:
    runs-on: ubuntu-26.04
    steps:
      - run: npm run test:unit
        env:
          WEB_UNIT_SHARD: "\${{ matrix.index }}/3"
`;

const webTurbo = (task) => ({ "apps/web/turbo.json": { extends: ["//"], tasks: { "test:unit": task } } });

// Rule 3 + rule 8 (#1091): unit-test.yml as checks + plan + web shards behind
// the Unit Tests summary.
const shardedUnitTest = () => `
name: Unit Tests
on:
  push:
    branches-ignore:
      - main
  workflow_call:
${cleanConcurrency("unit-test")}
jobs:
  checks:
    name: "Unit Tests: checks"
    runs-on: ubuntu-26.04
    steps: [{ run: "npm run lint:test-shards" }]
  plan:
    name: "Unit Tests: plan"
    runs-on: ubuntu-26.04
    steps: [{ run: "node scripts/test-shards.mjs plan --suite web" }]
  web:
    name: "Unit Tests (web shard \${{ matrix.index }})"
    needs: [plan]
    strategy:
      matrix: \${{ fromJSON(needs.plan.outputs.matrix) }}
    runs-on: ubuntu-26.04
    steps: [{ run: "true" }]
  summary:
    name: Unit Tests
    needs: [checks, plan, web]
    if: \${{ !cancelled() }}
    runs-on: ubuntu-26.04
    steps: [{ run: "true" }]
`;

// Rule 8 fixtures: push workflows of a chosen weight.
const pushWith = (jobsYaml, on = "push") => `
name: Some
on: ${on}
jobs:
${jobsYaml}
`;
const legs = (n) => `[${Array.from({ length: n }, (_, i) => i + 1).join(", ")}]`;
const matrixJob = (id, n, needs) => `
  ${id}:
    runs-on: ubuntu-26.04${needs ? `\n    needs: ${needs}` : ""}
    strategy:
      matrix:
        index: ${legs(n)}
    steps: [{ run: "true" }]
`;
const plainJob = (id, needs) => `
  ${id}:
    runs-on: ubuntu-26.04${needs ? `\n    needs: ${needs}` : ""}
    steps: [{ run: "true" }]
`;
const fanout = (n) => pushWith(matrixJob("legs", n));

// Rule 3 (#857) fixtures: integration-test.yml as a matrix of shards behind a
// summary job.
const shardedIntegration = ({
  summaryName = "Integration Tests",
  summaryIf = "always()",
  summaryNeeds = "[changes, plan, shard]",
  shardName = "Integration Tests (shard \${{ matrix.index }})",
} = {}) => `
name: Integration Tests
on: push
${cleanConcurrency("integration-test")}
jobs:
  changes:
    name: "Integration Tests: changes"
    runs-on: ubuntu-26.04
    steps: [{ run: "true" }]
  plan:
    name: "Integration Tests: plan"
    needs: [changes]
    runs-on: ubuntu-26.04
    steps: [{ run: "true" }]
  shard:
    name: "${shardName}"
    needs: [changes, plan]
    strategy:
      matrix:
        index: [1, 2]
    runs-on: ubuntu-26.04
    steps: [{ run: "true" }]
  summary:
    name: "${summaryName}"
    needs: ${summaryNeeds}
    if: ${summaryIf}
    runs-on: ubuntu-26.04
    steps: [{ run: "true" }]
`;

const pinnedRunner = (runsOn) => `
name: Some
on: push
jobs:
  build:
    runs-on: ${runsOn}
    steps:
      - run: echo ok
`;

const FIXTURES = [
  {
    name: "rule 7 — a job on a floating ubuntu-latest label",
    files: { "some.yml": pinnedRunner("ubuntu-latest") },
    expectRule: 7,
  },
  {
    name: "rule 7 — a floating label inside a runs-on list",
    files: { "some.yml": pinnedRunner("[self-hosted, ubuntu-latest]") },
    expectRule: 7,
  },
  {
    name: "rule 7 — a pinned image",
    files: { "some.yml": pinnedRunner("ubuntu-26.04") },
    expectRule: null,
  },
  {
    name: "rule 1 — runs turbo with no credentials",
    files: { "some.yml": runsTurbo() },
    turboScripts: ["build"],
    expectRule: 1,
  },
  {
    name: "rule 1 — runs turbo with credentials in workflow-level env",
    files: { "some.yml": runsTurbo({ env: CACHE_ENV }) },
    turboScripts: ["build"],
    expectRule: null,
  },
  {
    name: "rule 1 — runs a turbo npm script with no credentials",
    files: { "some.yml": runsTurbo({ command: "npm run build" }) },
    turboScripts: ["build"],
    expectRule: 1,
  },
  {
    name: "rule 1 — runs a NON-turbo npm script, no credentials needed",
    files: { "some.yml": runsTurbo({ command: "npm run lint:doc-pointers" }) },
    turboScripts: ["build", "lint"],
    expectRule: null,
  },
  {
    name: "rule 2 — call site omits a secret the callee declares",
    files: {
      "callee.yml": calleeDeclaring("TURBO_TOKEN"),
      "caller.yml": callerPassing(""),
    },
    expectRule: 2,
  },
  {
    name: "rule 2 — call site passes the declared secret",
    files: {
      "callee.yml": calleeDeclaring("TURBO_TOKEN"),
      "caller.yml": callerPassing(
        "    secrets:\n      TURBO_TOKEN: \${{ secrets.TURBO_TOKEN }}\n"
      ),
    },
    expectRule: null,
  },
  {
    name: "rule 2 — call site uses secrets: inherit",
    files: {
      "callee.yml": calleeDeclaring("TURBO_TOKEN"),
      "caller.yml": callerPassing("    secrets: inherit\n"),
    },
    expectRule: null,
  },
  {
    name: "rule 5 — apps/site/turbo.json missing entirely",
    files: {},
    siteTurbo: null,
    expectRule: 5,
  },
  {
    name: "rule 5 — site build declares no cache flag",
    files: {},
    siteTurbo: siteTurbo({ env: SITE_ENV }),
    expectRule: 5,
  },
  {
    name: "rule 5 — site build is explicitly cacheable",
    files: {},
    siteTurbo: siteTurbo({ cache: true, env: SITE_ENV }),
    expectRule: 5,
  },
  {
    name: "rule 5 — site build uncached but no vars declared at all",
    files: {},
    siteTurbo: siteTurbo({ cache: false, env: [], passThroughEnv: [] }),
    expectRule: 5,
  },
  {
    name: "rule 5 — site build uncached with env declared",
    files: {},
    siteTurbo: siteTurbo({ cache: false, env: SITE_ENV }),
    expectRule: null,
  },
  {
    name: "rule 5 — site build uncached with passThroughEnv declared (the real shape)",
    files: {},
    siteTurbo: siteTurbo({ cache: false, passThroughEnv: SITE_ENV }),
    expectRule: null,
  },

  {
    name: "rule 3 — a required-check job renamed",
    files: { "static-checks.yml": staticChecks({ jobName: "Static Analysis" }) },
    expectRule: 3,
  },
  {
    name: "rule 3 — required-check job names intact",
    files: { "static-checks.yml": staticChecks(), "unit-test.yml": unitTest() },
    expectRule: null,
  },
  {
    name: "rule 4 — concurrency.group leads with github.workflow",
    files: {
      "unit-test.yml": unitTest({
        concurrency: `
concurrency:
  group: "\${{ github.workflow }}-\${{ github.ref }}"
  cancel-in-progress: true
`,
      }),
    },
    expectRule: 4,
  },
  {
    name: "rule 4 — concurrency.group leads with a literal",
    files: { "unit-test.yml": unitTest() },
    expectRule: null,
  },
  {
    name: "rule 4 — concurrency block missing entirely",
    files: { "unit-test.yml": unitTest({ concurrency: "" }) },
    expectRule: 4,
  },

  {
    name: "rule 3 — a sharded check behind an always() summary that needs every shard",
    files: { "integration-test.yml": shardedIntegration() },
    expectRule: null,
  },
  {
    name: "rule 3 — a summary gated on !cancelled() (runs on a failed shard, not after a cancel)",
    files: { "integration-test.yml": shardedIntegration({ summaryIf: "\${{ !cancelled() }}" }) },
    expectRule: null,
  },
  {
    name: "rule 3 — the summary job skips when a shard fails (no always())",
    files: { "integration-test.yml": shardedIntegration({ summaryIf: "success()" }) },
    expectRule: 3,
  },
  {
    name: "rule 3 — the summary job doesn't wait for the shards",
    files: { "integration-test.yml": shardedIntegration({ summaryNeeds: "[changes, plan]" }) },
    expectRule: 3,
  },
  {
    name: "rule 3 — the matrix job itself carries the required name",
    files: {
      "integration-test.yml": shardedIntegration({
        summaryName: "Integration summary",
        shardName: "Integration Tests",
      }),
    },
    expectRule: 3,
  },

  {
    name: "rule 6 — shard var set and hashed by test:integration",
    files: { "shards.yml": setsShard() },
    turboFiles: rootTurbo({ env: ["REDIS_URL", "INTEGRATION_SHARD"] }),
    expectRule: null,
  },
  {
    name: "rule 6 — shard var set but missing from test:integration's env",
    files: { "shards.yml": setsShard() },
    turboFiles: rootTurbo({ env: ["REDIS_URL"] }),
    expectRule: 6,
  },
  {
    name: "rule 6 — shard var only in passThroughEnv (reaches Jest, not the hash)",
    files: { "shards.yml": setsShard() },
    turboFiles: rootTurbo({ env: ["REDIS_URL"], passThroughEnv: ["INTEGRATION_SHARD"] }),
    expectRule: 6,
  },
  {
    name: "rule 6 — shard var in both env and passThroughEnv",
    files: { "shards.yml": setsShard() },
    turboFiles: rootTurbo({
      env: ["INTEGRATION_SHARD"],
      passThroughEnv: ["INTEGRATION_SHARD"],
    }),
    expectRule: 6,
  },

  {
    name: "rule 6 — the web shard var hashed by apps/web/turbo.json's test:unit",
    files: { "web.yml": setsWebShard() },
    turboFiles: webTurbo({ env: ["WEB_UNIT_SHARD"] }),
    expectRule: null,
  },
  {
    name: "rule 6 — the web shard var missing from apps/web's test:unit env",
    files: { "web.yml": setsWebShard() },
    turboFiles: webTurbo({ env: [] }),
    expectRule: 6,
  },
  {
    name: "rule 6 — the web shard var only in passThroughEnv",
    files: { "web.yml": setsWebShard() },
    turboFiles: webTurbo({ passThroughEnv: ["WEB_UNIT_SHARD"] }),
    expectRule: 6,
  },
  {
    name: "rule 6 — the web shard var set, but apps/web/turbo.json absent",
    files: { "web.yml": setsWebShard() },
    turboFiles: { "apps/web/turbo.json": null },
    expectRule: 6,
  },

  {
    name: "rule 3 — Unit Tests as checks + plan + web shards behind a !cancelled() summary",
    files: { "unit-test.yml": shardedUnitTest() },
    expectRule: null,
  },

  {
    name: "rule 8 — a push whose peak is exactly the limit",
    files: { "a.yml": fanout(20) },
    expectRule: null,
  },
  {
    name: "rule 8 — one job over the limit",
    files: { "a.yml": fanout(20), "b.yml": pushWith(plainJob("one")) },
    expectRule: 8,
  },
  {
    name: "rule 8 — a web-planned dynamic matrix weighs the web cap (6 + 1 checks + 14 = 21)",
    files: { "unit-test.yml": shardedUnitTest(), "b.yml": fanout(14) },
    expectRule: 8,
  },
  {
    name: "rule 8 — the same with room to spare (6 + 1 + 13 = 20)",
    files: { "unit-test.yml": shardedUnitTest(), "b.yml": fanout(13) },
    expectRule: null,
  },
  {
    name: "rule 8 — a dynamic matrix no test-shards plan sizes is unbounded",
    files: {
      "a.yml": pushWith(`${plainJob("plan")}
  shards:
    runs-on: ubuntu-26.04
    needs: [plan]
    strategy:
      matrix: \${{ fromJSON(needs.plan.outputs.matrix) }}
    steps: [{ run: "true" }]
`),
    },
    expectRule: 8,
  },
  {
    name: "rule 8 — a literal 2×3 matrix weighs 6 (6 + 15 = 21)",
    files: {
      "a.yml": pushWith(`
  grid:
    runs-on: ubuntu-26.04
    strategy:
      matrix:
        os: [a, b]
        node: [1, 2, 3]
    steps: [{ run: "true" }]
`),
      "b.yml": fanout(15),
    },
    expectRule: 8,
  },
  {
    name: "rule 8 — a needs chain counts its heaviest job, not the sum (10 + 10 = 20)",
    files: {
      "a.yml": pushWith(
        plainJob("changes") + plainJob("plan", "[changes]") + matrixJob("shards", 10, "[changes, plan]") + plainJob("summary", "[changes, plan, shards]")
      ),
      "b.yml": fanout(10),
    },
    expectRule: null,
  },
  {
    name: "rule 8 — a job beside the shards adds to them (1 + 10 + 10 = 21)",
    files: {
      "a.yml": pushWith(plainJob("checks") + matrixJob("shards", 10) + plainJob("summary", "[checks, shards]")),
      "b.yml": fanout(10),
    },
    expectRule: 8,
  },
  {
    name: "rule 8 — a push to main only isn't a branch push",
    files: { "a.yml": pushWith(matrixJob("legs", 25), "\n  push:\n    branches: [main]") },
    expectRule: null,
  },
  {
    name: "rule 8 — a matrix with include can't be sized",
    files: {
      "a.yml": pushWith(`
  legs:
    runs-on: ubuntu-26.04
    strategy:
      matrix:
        index: [1]
        include: [{ index: 2 }]
    steps: [{ run: "true" }]
`),
    },
    expectRule: 8,
  },
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function toWorkflows(files) {
  return Object.entries(files).map(([file, text]) => ({ file, doc: parse(text) }));
}

function runSelfTest() {
  const failures = [];

  for (const fixture of FIXTURES) {
    const found = findViolations({
      workflows: toWorkflows(fixture.files),
      ...("siteTurbo" in fixture ? { siteTurbo: fixture.siteTurbo } : {}),
      ...("turboFiles" in fixture ? { turboFiles: fixture.turboFiles } : {}),
      ...(fixture.turboScripts ? { turboScripts: fixture.turboScripts } : {}),
    });

    if (fixture.expectRule === null) {
      if (found.length > 0) {
        failures.push(
          `  ✗ ${fixture.name}\n      expected no violation, got: ${found
            .map((v) => `rule ${v.rule} (${v.message})`)
            .join("; ")}`
        );
      }
      continue;
    }

    if (!found.some((v) => v.rule === fixture.expectRule)) {
      failures.push(
        `  ✗ ${fixture.name}\n      expected a rule ${fixture.expectRule} violation, got: ${
          found.length ? found.map((v) => `rule ${v.rule}`).join("; ") : "none"
        }`
      );
    }
  }

  if (failures.length) {
    console.error(`self-test: ${failures.length} of ${FIXTURES.length} fixture(s) failed\n`);
    console.error(failures.join("\n"));
    return false;
  }

  console.log(`self-test: ${FIXTURES.length} fixture(s) passed`);
  return true;
}

function runRealTree() {
  const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const workflows = files.map((file) => ({
    file,
    doc: parse(readFileSync(path.join(WORKFLOW_DIR, file), "utf8")),
  }));

  // turbo.json is JSONC — it carries `//` comments, and those comments are
  // load-bearing documentation here. JSON.parse would throw on them, and
  // stripping `//` with a regex would corrupt the `$schema` URL.
  let siteTurbo = null;
  try {
    siteTurbo = parseJsonc(readFileSync(path.join(REPO_ROOT, SITE_TURBO_PATH), "utf8"));
  } catch {
    siteTurbo = null; // absent or unparseable — rule 5 reports it
  }

  // Every turbo.json a suite's shard var must be hashed in (rule 6), parsed
  // or null when absent.
  const turboFiles = {};
  for (const file of new Set(Object.values(SUITES).map((suite) => suite.turboFile))) {
    try {
      turboFiles[file] = parseJsonc(readFileSync(path.join(REPO_ROOT, file), "utf8"));
    } catch {
      turboFiles[file] = null; // absent or unparseable — rule 6 reports it once a workflow shards
    }
  }

  // Derived, never hardcoded: any root script whose body starts with `turbo run`
  // is a turbo passthrough, so the list cannot drift from package.json.
  const rootPkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const turboScripts = Object.entries(rootPkg.scripts ?? {})
    .filter(([, body]) => /^turbo run /.test(body))
    .map(([name]) => name);

  const found = findViolations({ workflows, siteTurbo, turboFiles, turboScripts });

  if (found.length) {
    console.error(`\n.github/workflows: ${found.length} violation(s)\n`);
    for (const v of found) console.error(`  ✗ [rule ${v.rule}] ${v.file}: ${v.message}`);
    return false;
  }

  const { total, peaks } = pushConcurrency(workflows);
  console.log(`.github/workflows: ${workflows.length} workflow(s) clean`);
  console.log(
    `one branch push peaks at ${total} of ${CONCURRENT_JOB_LIMIT} concurrent jobs ` +
      `(${peaks.map((p) => `${p.file} ${p.peak}`).join(", ")})`
  );
  return true;
}

const selfTestOnly = process.argv.includes("--self-test");
const ok = runSelfTest() && (selfTestOnly || runRealTree());
process.exit(ok ? 0 : 1);
