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
 *   - rule 3: required-check job names are exactly the three gated on `main`
 *   - rule 4: those workflows' `concurrency.group` leads with a literal
 *   - rule 5: `apps/site`'s build stays uncached, with its env declared
 *   - rule 1: a workflow that runs turbo carries the cache credentials
 *   - rule 2: a workflow_call site passes every secret the callee declares
 *
 * Usage: npm run lint:ci-cache [-- --self-test]
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { parse as parseJsonc } from "jsonc-parser";

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
 * @param {{workflows?: Array<{file: string, doc: any}>, siteTurbo?: any, turboScripts?: string[]}} input
 * @returns {Array<{rule: number, file: string, message: string}>}
 */
export function findViolations({ workflows = [], siteTurbo, turboScripts = [] } = {}) {
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

  return violations;
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
    runs-on: ubuntu-latest
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
    runs-on: ubuntu-latest
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
    runs-on: ubuntu-latest
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
    runs-on: ubuntu-latest
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

const FIXTURES = [
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

  // Derived, never hardcoded: any root script whose body starts with `turbo run`
  // is a turbo passthrough, so the list cannot drift from package.json.
  const rootPkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const turboScripts = Object.entries(rootPkg.scripts ?? {})
    .filter(([, body]) => /^turbo run /.test(body))
    .map(([name]) => name);

  const found = findViolations({ workflows, siteTurbo, turboScripts });

  if (found.length) {
    console.error(`\n.github/workflows: ${found.length} violation(s)\n`);
    for (const v of found) console.error(`  ✗ [rule ${v.rule}] ${v.file}: ${v.message}`);
    return false;
  }

  console.log(`.github/workflows: ${workflows.length} workflow(s) clean`);
  return true;
}

const selfTestOnly = process.argv.includes("--self-test");
const ok = runSelfTest() && (selfTestOnly || runRealTree());
process.exit(ok ? 0 : 1);
