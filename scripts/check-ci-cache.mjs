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
 * Rules 1-2 (credentials) and rule 5 (`apps/site` uncached) arrive later.
 *
 * Usage: npm run lint:ci-cache [-- --self-test]
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

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

/**
 * Finds every rule violation. Pure: takes already-parsed inputs, touches no
 * filesystem, so the fixtures below and the real tree run through the exact
 * same code path.
 *
 * @param {{workflows?: Array<{file: string, doc: any}>}} input
 * @returns {Array<{rule: number, file: string, message: string}>}
 */
export function findViolations({ workflows = [] } = {}) {
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

const FIXTURES = [
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
    const found = findViolations({ workflows: toWorkflows(fixture.files) });

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

  const found = findViolations({ workflows });

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
