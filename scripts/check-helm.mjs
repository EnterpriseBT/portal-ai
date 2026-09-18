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

// External data-dep values for the "managed endpoints" render path.
const EXTERNAL_ARGS = [
  "--set",
  "postgresql.enabled=false",
  "--set",
  "redis.enabled=false",
  "--set",
  "minio.enabled=false",
  "--set",
  "postgresql.external.host=db.example.com",
  "--set",
  "postgresql.external.password=pw",
  "--set",
  "redis.external.url=redis://cache.example.com:6379",
  "--set",
  "minio.external.endpoint=https://s3.example.com",
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

/**
 * Fetch the pinned subchart dependencies (Chart.lock). Bitnami's index is
 * needed for the HTTP repo entries; adding it is idempotent. A failure here is
 * fatal — a missing/renamed pinned chart must fail loudly, not silently render
 * without its data deps.
 */
function buildDependencies() {
  execFileSync(
    "helm",
    [
      "repo",
      "add",
      "bitnami",
      "https://charts.bitnami.com/bitnami",
      "--force-update",
    ],
    { stdio: "ignore" }
  );
  run(["dependency", "build", CHART]);
}

/** A rendered scenario plus the assertions it must satisfy. */
const scenarios = [
  {
    name: "defaults (api + web + bundled data deps)",
    args: ["template", "p", CHART, ...IMAGE_ARGS],
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
      [
        "bundled DATABASE_URL points at the postgresql service",
        (out) => /DATABASE_URL: "postgresql:\/\/[^"]*@p-postgresql:5432\//.test(out),
      ],
      [
        "bundled REDIS_URL points at the redis master service",
        (out) => out.includes('REDIS_URL: "redis://p-redis-master:6379"'),
      ],
      [
        "bundled DB uses the PostGIS image override",
        (out) => out.includes("imresamu/postgis:17-3.5"),
      ],
      [
        "bundled Redis has a persistent volume claim",
        (out) => out.includes("kind: PersistentVolumeClaim"),
      ],
      ["bundled MinIO renders", (out) => out.includes("p-minio")],
      [
        "migrate hook: pre-install only + command",
        (out) =>
          out.includes('"helm.sh/hook": pre-install\n') &&
          out.includes('command: ["node", "dist/scripts/db-migrate.js"]'),
      ],
      [
        "seed hook: post-install + command",
        (out) =>
          out.includes('"helm.sh/hook": post-install') &&
          out.includes('command: ["node", "dist/db/seed.js"]'),
      ],
      [
        "upgrade hook: pre-upgrade + db-upgrade command",
        (out) =>
          out.includes('"helm.sh/hook": pre-upgrade') &&
          out.includes('command: ["node", "dist/scripts/db-upgrade.js"]'),
      ],
      [
        "no ingress or bundled issuer by default",
        (out) => !out.includes("kind: Ingress") && !out.includes("keycloak"),
      ],
    ],
  },
  {
    name: "ingress enabled",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "ingress.enabled=true",
      "--set",
      "ingress.host=app.example.com",
      "--set",
      "ingress.className=nginx",
      "--set",
      "ingress.tls.enabled=true",
      "--set",
      "ingress.tls.secretName=app-tls",
    ],
    assertions: [
      ["Ingress renders", (out) => out.includes("kind: Ingress")],
      [
        "routes /api to the api service",
        (out) => /path: \/api\b[\s\S]*?name: p-portalai-api/.test(out),
      ],
      [
        "routes / to the web service",
        (out) => /name: p-portalai-web\b/.test(out),
      ],
      ["TLS secret wired", (out) => out.includes('secretName: "app-tls"')],
    ],
  },
  {
    name: "bundled issuer (keycloak)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "bundledIssuer.enabled=true",
    ],
    assertions: [
      ["Keycloak subchart renders", (out) => out.includes("keycloak")],
    ],
  },
  {
    name: "hooks disabled",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "migrate.enabled=false",
      "--set",
      "seed.enabled=false",
      "--set",
      "upgrade.enabled=false",
    ],
    assertions: [
      [
        "no migrate/seed/upgrade jobs render when disabled",
        (out) =>
          !out.includes("db-migrate.js") &&
          !out.includes("dist/db/seed.js") &&
          !out.includes("db-upgrade.js"),
      ],
    ],
  },
  {
    name: "external (managed endpoints)",
    args: ["template", "p", CHART, ...IMAGE_ARGS, ...EXTERNAL_ARGS],
    assertions: [
      [
        "external DATABASE_URL",
        (out) => out.includes('DATABASE_URL: "postgresql://portalai:pw@db.example.com:5432/portalai"'),
      ],
      [
        "external REDIS_URL",
        (out) => out.includes('REDIS_URL: "redis://cache.example.com:6379"'),
      ],
      [
        "external S3 endpoint",
        (out) => out.includes('UPLOAD_S3_ENDPOINT: "https://s3.example.com"'),
      ],
      [
        "no bundled subchart objects render",
        (out) =>
          !out.includes("p-postgresql") &&
          !out.includes("p-redis") &&
          !out.includes("p-minio"),
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

  // Fetch pinned subchart deps (Chart.lock) before lint/template.
  try {
    buildDependencies();
    console.log("✓ helm dependency build (pinned subcharts)");
  } catch (err) {
    console.error(
      "✗ helm dependency build failed — a pinned subchart could not be " +
        "fetched (network, or a moved/renamed Bitnami chart):\n" +
        (err.stderr || err.stdout || err.message)
    );
    process.exit(1);
  }

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
