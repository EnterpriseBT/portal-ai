#!/usr/bin/env node
/**
 * Renders the Portals AI Helm chart and asserts its load-bearing invariants
 * (#566). The chart is outside the turbo build graph and jest, so this is its
 * only automated gate short of a live `helm install` (the EKS smoke).
 *
 * It runs `helm lint` plus `helm template` over a set of value scenarios and
 * checks the rendered manifests string-by-string. Scenarios are added slice by
 * slice: slice 3 pins the api/web skeleton (both probes, non-root, image refs);
 * slice 4 adds the bundled-vs-external data-dep render paths.
 *
 * Fail-open on tooling: if `helm` is not installed the check WARNS and exits 0
 * rather than failing (local runs without helm shouldn't block). CI installs
 * helm explicitly, so an absent binary there means the install step failed —
 * which is loud on its own.
 *
 * Usage: npm run lint:helm
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const CHART = path.join(REPO_ROOT, "deploy", "helm", "portalai");

// Minimal images every render needs (the chart `required`s them).
const IMAGE_ARGS = [
  "--set",
  "image.api.repository=example/api",
  "--set",
  "image.api.tag=test",
  "--set",
  "image.web.repository=example/web",
  "--set",
  "image.web.tag=test",
];

function helmAvailable() {
  try {
    execFileSync("helm", ["version", "--short"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(args) {
  return execFileSync("helm", args, { encoding: "utf8" });
}

/** A rendered scenario plus the assertions it must satisfy. */
const scenarios = [
  {
    name: "defaults (api + web skeleton)",
    args: ["template", "portalai", CHART, ...IMAGE_ARGS],
    assertions: [
      ["api liveness probe", (out) => out.includes("path: /api/health\n")],
      [
        "api readiness probe",
        (out) => out.includes("path: /api/health/ready"),
      ],
      ["non-root workloads", (out) => out.includes("runAsNonRoot: true")],
      ["api image reference", (out) => out.includes('image: "example/api:test"')],
      ["web image reference", (out) => out.includes('image: "example/web:test"')],
      [
        "api reads env from ConfigMap + Secret",
        (out) =>
          out.includes("configMapRef:") && out.includes("secretRef:"),
      ],
    ],
  },
];

function main() {
  if (!helmAvailable()) {
    console.warn(
      "⚠️  helm not found on PATH — skipping chart checks. " +
        "(CI installs helm; install it locally to run this check.)"
    );
    process.exit(0);
  }

  const failures = [];

  // helm lint
  try {
    run(["lint", CHART]);
    console.log("✓ helm lint clean");
  } catch (err) {
    console.error("✗ helm lint failed:\n" + (err.stdout || err.message));
    failures.push("helm lint");
  }

  // helm template scenarios
  for (const scenario of scenarios) {
    let out;
    try {
      out = run(scenario.args);
    } catch (err) {
      console.error(
        `✗ helm template [${scenario.name}] failed to render:\n` +
          (err.stderr || err.stdout || err.message)
      );
      failures.push(`render: ${scenario.name}`);
      continue;
    }
    for (const [label, predicate] of scenario.assertions) {
      if (predicate(out)) {
        console.log(`✓ [${scenario.name}] ${label}`);
      } else {
        console.error(`✗ [${scenario.name}] ${label}`);
        failures.push(`${scenario.name}: ${label}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} helm chart check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll helm chart checks passed.");
}

main();
