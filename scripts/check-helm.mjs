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
import fs from "node:fs";
import os from "node:os";
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

/**
 * Values the chart must refuse at `helm template`/`install` time, each with a
 * pattern its error has to match (so an unrelated render failure can't pass
 * for the intended refusal).
 */
const rejectScenarios = [
  {
    name: "custom basemap without a style URL (#910)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "web.basemap.mode=custom",
    ],
    error: /basemap[\s\S]*styleUrl/,
  },
  {
    name: "unknown basemap mode (#910)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "web.basemap.mode=off",
    ],
    error: /basemap[\s\S]*mode/,
  },
  {
    name: "a basemap URL that isn't http(s) (#910)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "web.basemap.mode=custom",
      "--set",
      "web.basemap.styleUrl=javascript:alert(1)",
    ],
    error: /basemap[\s\S]*styleUrl/,
  },
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
// #660: the rendered manifest for one object, so an assertion can check what a
// single workload carries (the migration credentials must stay off the API).
const manifest = (out, kind, name) =>
  out
    .split(/^---$/m)
    .find(
      (doc) =>
        doc.includes(`kind: ${kind}\n`) && doc.includes(`name: ${name}\n`)
    ) ?? "";

const apiHasNoMigrationCreds = (out) => {
  const api = manifest(out, "Deployment", "p-portalai-api");
  return (
    api !== "" &&
    !api.includes("MIGRATE_DATABASE_URL") &&
    !api.includes("MIGRATE_DATABASE_PASSWORD")
  );
};

// #889, #891: every value the ConfigMap carries for `key`. The public URLs
// default from the ingress, so each must render once, or not at all.
const configValues = (out, key) =>
  [
    ...manifest(out, "ConfigMap", "p-portalai-config").matchAll(
      new RegExp(`^\\s+${key}: "([^"]*)"$`, "gm")
    ),
  ].map((m) => m[1]);
const webAppUrls = (out) => configValues(out, "WEB_APP_URL");
const publicApiUrls = (out) => configValues(out, "PUBLIC_API_BASE_URL");

const MIGRATION_USER_ARGS = [
  "--set",
  "postgresql.external.migrationUser=owner",
];

// #891: the install notes name a missing public URL in the API's own words.
// `helm template` doesn't render NOTES.txt, so render it as a ConfigMap
// through `tpl` in a scratch copy of the chart.
function renderNotes(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portalai-notes-"));
  try {
    const chart = path.join(dir, "chart");
    fs.cpSync(CHART, chart, { recursive: true });
    fs.renameSync(
      path.join(chart, "templates", "NOTES.txt"),
      path.join(chart, "notes.tpl")
    );
    fs.writeFileSync(
      path.join(chart, "templates", "zz-notes.yaml"),
      'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: rendered-notes\ndata:\n  notes: |\n{{ tpl (.Files.Get "notes.tpl") . | indent 4 }}\n'
    );
    const out = run([
      "template",
      "p",
      chart,
      ...IMAGE_ARGS,
      ...args,
      "--show-only",
      "templates/zz-notes.yaml",
    ]);
    return out.split("notes: |")[1] ?? "";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The consequence sentences the API logs, from `public-url.util.ts`. */
function apiConsequences() {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "apps/api/src/utils/public-url.util.ts"),
    "utf8"
  );
  const pick = (key) => {
    const m = new RegExp(`${key}:\\s*"([^"]+)"`).exec(src);
    if (!m) throw new Error(`PUBLIC_URL_CONSEQUENCES.${key} not found`);
    return m[1];
  };
  return {
    WEB_APP_URL: pick("WEB_APP_URL"),
    PUBLIC_API_BASE_URL: pick("PUBLIC_API_BASE_URL"),
  };
}

const flat = (text) => text.replace(/\s+/g, " ");
const notesSay = (notes, key, consequence) =>
  flat(notes).includes(`${key} isn't set`) &&
  flat(notes).includes(consequence);

const notesScenarios = () => {
  const said = apiConsequences();
  return [
    {
      name: "notes: no ingress, no config",
      args: [],
      assertions: [
        [
          "names WEB_APP_URL in the API's words",
          (n) => notesSay(n, "WEB_APP_URL", said.WEB_APP_URL),
        ],
        [
          "names PUBLIC_API_BASE_URL in the API's words",
          (n) =>
            notesSay(n, "PUBLIC_API_BASE_URL", said.PUBLIC_API_BASE_URL),
        ],
      ],
    },
    {
      name: "notes: TLS ingress",
      args: [
        "--set",
        "ingress.enabled=true",
        "--set",
        "ingress.host=app.example.com",
        "--set",
        "ingress.tls.enabled=true",
      ],
      assertions: [
        ["names no missing URL", (n) => !flat(n).includes("isn't set")],
      ],
    },
    {
      name: "notes: only config.PUBLIC_API_BASE_URL",
      args: ["--set", "config.PUBLIC_API_BASE_URL=https://api.example.org"],
      assertions: [
        [
          "names only WEB_APP_URL",
          (n) =>
            flat(n).includes("WEB_APP_URL isn't set") &&
            !flat(n).includes("PUBLIC_API_BASE_URL isn't set"),
        ],
      ],
    },
    {
      name: "notes: ingress + empty config.PUBLIC_API_BASE_URL",
      args: [
        "--set",
        "ingress.enabled=true",
        "--set",
        "ingress.host=app.example.com",
        "--set",
        "config.PUBLIC_API_BASE_URL=",
      ],
      assertions: [
        [
          "an empty value isn't 'set': the ingress default applies, so no note",
          (n) => !flat(n).includes("PUBLIC_API_BASE_URL isn't set"),
        ],
      ],
    },
  ];
};

// The `web.basemap` values a custom-tile-server install sets (#910).
const CUSTOM_BASEMAP_ARGS = [
  "--set",
  "web.basemap.mode=custom",
  "--set",
  "web.basemap.styleUrl=https://tiles.corp.example/light.json",
  "--set",
  "web.basemap.styleUrlDark=https://tiles.corp.example/dark.json",
  "--set-string",
  "web.basemap.attribution=© Corp tiles",
];

const scenarios = [
  {
    name: "custom basemap (#910)",
    args: ["template", "p", CHART, ...IMAGE_ARGS, ...CUSTOM_BASEMAP_ARGS],
    assertions: [
      [
        "BASEMAP_* reach the web config.js env",
        (out) =>
          out.includes('BASEMAP_MODE: "custom"') &&
          out.includes(
            'BASEMAP_STYLE_URL: "https://tiles.corp.example/light.json"'
          ) &&
          out.includes(
            'BASEMAP_STYLE_URL_DARK: "https://tiles.corp.example/dark.json"'
          ) &&
          out.includes('BASEMAP_ATTRIBUTION: "© Corp tiles"'),
      ],
    ],
  },
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
      [
        "no basemap by default: no third-party tile egress (#910)",
        (out) => out.includes('BASEMAP_MODE: "none"'),
      ],
      ["api image reference", (out) => out.includes('image: "example/api:test"')],
      ["web image reference", (out) => out.includes('image: "example/web:test"')],
      [
        "no WEB_APP_URL without an ingress or config (#889)",
        (out) => webAppUrls(out).length === 0,
      ],
      [
        "no PUBLIC_API_BASE_URL without an ingress or config (#891)",
        (out) => publicApiUrls(out).length === 0,
      ],
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
        "bundled Redis stays plaintext: no REDIS_TLS_CA (#852)",
        (out) => !out.includes("REDIS_TLS_CA"),
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
        "bundled: migrate + upgrade jobs provision the reader role as the subchart's postgres superuser (#660)",
        (out) =>
          ["p-portalai-migrate", "p-portalai-upgrade"].every((job) => {
            const doc = manifest(out, "Job", job);
            return (
              doc.includes("name: p-postgresql\n") &&
              doc.includes("key: postgres-password") &&
              doc.includes("name: MIGRATE_DATABASE_PASSWORD") &&
              doc.includes(
                'value: "postgresql://postgres@p-postgresql:5432/portalai"'
              )
            );
          }),
      ],
      ["the API pods never get the migration credentials (#660)", apiHasNoMigrationCreds],
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
      [
        "invite links default to the ingress origin (#889)",
        (out) => webAppUrls(out).join() === "https://app.example.com",
      ],
      [
        "webhook callbacks default to the ingress origin (#891)",
        (out) => publicApiUrls(out).join() === "https://app.example.com",
      ],
    ],
  },
  {
    name: "ingress without TLS (#889)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "ingress.enabled=true",
      "--set",
      "ingress.host=portal.corp",
    ],
    assertions: [
      [
        "invite links default to http on the ingress host",
        (out) => webAppUrls(out).join() === "http://portal.corp",
      ],
      [
        "webhook callbacks default to http on the ingress host",
        (out) => publicApiUrls(out).join() === "http://portal.corp",
      ],
    ],
  },
  {
    name: "an empty config URL falls back to the ingress default (#891)",
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
      "config.PUBLIC_API_BASE_URL=",
    ],
    assertions: [
      [
        "PUBLIC_API_BASE_URL renders once, from the ingress",
        (out) => publicApiUrls(out).join() === "http://app.example.com",
      ],
    ],
  },
  {
    name: "explicit config URLs beat the ingress defaults (#889, #891)",
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
      "config.WEB_APP_URL=https://portal.example.org",
      "--set",
      "config.PUBLIC_API_BASE_URL=https://api.example.org",
    ],
    assertions: [
      [
        "WEB_APP_URL renders once, from config",
        (out) => webAppUrls(out).join() === "https://portal.example.org",
      ],
      [
        "PUBLIC_API_BASE_URL renders once, from config",
        (out) => publicApiUrls(out).join() === "https://api.example.org",
      ],
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
      [
        "no migration user configured: migrations run as DATABASE_URL (#660)",
        (out) =>
          !out.includes("MIGRATE_DATABASE_URL") &&
          manifest(out, "Secret", "p-portalai-migrate") === "",
      ],
      [
        "no CA secret configured: no REDIS_TLS_CA (#852)",
        (out) => !out.includes("REDIS_TLS_CA"),
      ],
    ],
  },
  {
    // #852: a managed TLS Redis whose cert chains to a private CA.
    name: "external rediss:// + private CA (#852)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      ...EXTERNAL_ARGS,
      "--set",
      "redis.external.url=rediss://cache.example.com:6380",
      "--set",
      "redis.external.tls.caSecret.name=redis-ca",
    ],
    assertions: [
      [
        "REDIS_URL keeps the rediss:// scheme",
        (out) => out.includes('REDIS_URL: "rediss://cache.example.com:6380"'),
      ],
      [
        "the API reads REDIS_TLS_CA from the CA secret (default key ca.crt)",
        (out) => {
          const api = manifest(out, "Deployment", "p-portalai-api");
          return /- name: REDIS_TLS_CA\n\s+valueFrom:\n\s+secretKeyRef:\n\s+name: redis-ca\n\s+key: ca\.crt/.test(
            api
          );
        },
      ],
    ],
  },
  {
    name: "external + migration user, inline password (#660)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      ...EXTERNAL_ARGS,
      ...MIGRATION_USER_ARGS,
      "--set",
      "postgresql.external.migrationPassword=owner-pw",
    ],
    assertions: [
      [
        "migration jobs get MIGRATE_DATABASE_URL for the migration user",
        (out) =>
          ["p-portalai-migrate", "p-portalai-upgrade"].every((job) =>
            manifest(out, "Job", job).includes(
              'value: "postgresql://owner@db.example.com:5432/portalai"'
            )
          ),
      ],
      [
        "the inline password lives in its own hook Secret, not the app Secret",
        (out) => {
          const own = manifest(out, "Secret", "p-portalai-migrate");
          const app = manifest(out, "Secret", "p-portalai-secret");
          return (
            own.includes('password: "owner-pw"') &&
            own.includes('"helm.sh/hook": pre-install,pre-upgrade') &&
            !app.includes("owner-pw")
          );
        },
      ],
      ["the API pods never get the migration credentials", apiHasNoMigrationCreds],
    ],
  },
  {
    name: "external + migration password with URL-special characters (#660)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      ...EXTERNAL_ARGS,
      ...MIGRATION_USER_ARGS,
      "--set-string",
      "postgresql.external.migrationPassword=p@ss/w:rd",
    ],
    assertions: [
      [
        "the password never enters the URL, so the host can't shift",
        (out) =>
          ["p-portalai-migrate", "p-portalai-upgrade"].every((job) => {
            const doc = manifest(out, "Job", job);
            const url = /name: MIGRATE_DATABASE_URL\n\s+value: "([^"]+)"/.exec(doc)?.[1];
            return (
              url === "postgresql://owner@db.example.com:5432/portalai" &&
              new URL(url).hostname === "db.example.com" &&
              !doc.includes("p@ss")
            );
          }),
      ],
    ],
  },
  {
    name: "external + migration user, existing Secret (#660)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      ...EXTERNAL_ARGS,
      ...MIGRATION_USER_ARGS,
      "--set",
      "postgresql.external.migrationExistingSecret.name=db-owner",
      "--set",
      "postgresql.external.migrationExistingSecret.key=pw",
    ],
    assertions: [
      [
        "migration jobs read the password from the existing Secret",
        (out) =>
          ["p-portalai-migrate", "p-portalai-upgrade"].every((job) => {
            const doc = manifest(out, "Job", job);
            return doc.includes("name: db-owner\n") && doc.includes("key: pw\n");
          }),
      ],
      [
        "no chart-rendered migrate Secret",
        (out) => manifest(out, "Secret", "p-portalai-migrate") === "",
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

  // values the chart must refuse (#910)
  for (const scenario of rejectScenarios) {
    try {
      run(scenario.args);
      console.error(`✗ [${scenario.name}] rendered, but must be refused`);
      failures.push(`reject: ${scenario.name}`);
    } catch (err) {
      const message = String(err.stderr || err.stdout || err.message);
      if (scenario.error.test(message)) {
        console.log(`✓ [${scenario.name}] refused`);
      } else {
        console.error(
          `✗ [${scenario.name}] failed for another reason:\n${message}`
        );
        failures.push(`reject: ${scenario.name}`);
      }
    }
  }

  // install notes (#891)
  for (const scenario of notesScenarios()) {
    let notes;
    try {
      notes = renderNotes(scenario.args);
    } catch (err) {
      console.error(
        `✗ [${scenario.name}] failed to render:\n` +
          (err.stderr || err.stdout || err.message)
      );
      failures.push(`render: ${scenario.name}`);
      continue;
    }
    for (const [label, predicate] of scenario.assertions) {
      if (predicate(notes)) {
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
