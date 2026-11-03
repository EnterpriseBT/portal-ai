#!/usr/bin/env node
/**
 * Renders the Portals AI Helm chart and asserts its load-bearing invariants
 * (#566). The chart is outside the turbo build graph and jest, so this is its
 * only automated gate short of a live `helm install` (the EKS smoke).
 *
 * It runs `helm lint` plus `helm template` over a set of value scenarios and
 * checks the rendered manifests string-by-string. Scenarios are added slice by
 * slice: slice 3 pins the api/web skeleton (both probes, non-root, image refs);
 * slice 4 adds the bundled-vs-external data-dep render paths. Since #946 the
 * bundled deps are the chart's own templates, not Bitnami subcharts (whose
 * images are gone), so there is no dependency build and no network access.
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
  "objectStorage.enabled=false",
  "--set",
  "postgresql.external.host=db.example.com",
  "--set",
  "postgresql.external.password=pw",
  "--set",
  "redis.external.url=redis://cache.example.com:6379",
  "--set",
  "objectStorage.external.endpoint=https://s3.example.com",
];

// #946: a residency install whose users sign in through the bundled Keycloak.
const BUNDLED_ISSUER_ARGS = [
  "--set",
  "deployMode=residency",
  "--set",
  "ingress.enabled=true",
  "--set",
  "ingress.host=app.example.com",
  "--set",
  "bundledIssuer.enabled=true",
  "--set",
  "bundledIssuer.host=auth.example.com",
];

/**
 * Values the chart must refuse at `helm template`/`install` time, each with a
 * pattern its error has to match (so an unrelated render failure can't pass
 * for the intended refusal).
 */
const rejectScenarios = [
  {
    // #946 review: the api pods wait for the bundled DB's first migration,
    // which only the migrate job runs, so this would hang forever.
    name: "bundled DB with migrate disabled on install (#946)",
    args: ["template", "p", CHART, ...IMAGE_ARGS, "--set", "migrate.enabled=false"],
    error: /migrate\.enabled=false needs an external DB/,
  },
  {
    // #946 review: Ingress rules[].host can't carry a port.
    name: "a bundled issuer host with a port (#946)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      ...BUNDLED_ISSUER_ARGS,
      "--set",
      "bundledIssuer.host=auth.example.com:8443",
    ],
    error: /bundledIssuer[\s\S]*host/,
  },
  {
    name: "an object storage public host with a port (#946)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "objectStorage.publicHost=s3.example.com:9000",
    ],
    error: /publicHost/,
  },
  {
    // #946: the migrations write 'SYSTEM' as the system principal (0065,
    // 0080), so any other id splits system ownership in two.
    name: "a SYSTEM_ID other than the migrations' (#946)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "config.SYSTEM_ID=other",
    ],
    error: /SYSTEM_ID/,
  },
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
  {
    // The SPA's reader would reject this at runtime and fall closed to `none`;
    // refusing it here keeps the install-time and runtime gates in agreement.
    name: "a basemap URL with whitespace (#910)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "web.basemap.mode=custom",
      "--set-string",
      "web.basemap.styleUrl=https:// not a url",
    ],
    error: /basemap[\s\S]*styleUrl/,
  },
  {
    // The issuer URL is the browser's and the API's, so it needs a public host.
    name: "bundled issuer without its host (#946)",
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
      "bundledIssuer.enabled=true",
    ],
    error: /bundledIssuer\.host/,
  },
  {
    // The realm's redirect URI and web origin are the app's origin.
    name: "bundled issuer without the app's ingress host (#946)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "bundledIssuer.enabled=true",
      "--set",
      "bundledIssuer.host=auth.example.com",
    ],
    error: /ingress\.host/,
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

// #946: every image a render pulls, so a default install can be checked for
// unavailable registries (Bitnami's images are gone; MinIO publishes none).
const images = (out) =>
  [...out.matchAll(/^\s+image: "?([^"\s]+)"?$/gm)].map((m) => m[1]);

// The init container named `name` in one workload's manifest, if any.
const hasInitContainer = (doc, name) =>
  /initContainers:/.test(doc) && doc.includes(`- name: ${name}\n`);

// #946: the ConfigMap/Secret names a workload loads env from (envFrom).
const envFromNames = (doc) =>
  [...doc.matchAll(/(?:configMapRef|secretRef):\n\s+name: (\S+)/g)].map(
    (m) => m[1]
  );

// #946: a manifest's body from `data:`/`stringData:` on, so two objects can be
// compared on what they carry rather than their names and annotations.
const dataOf = (doc) => doc.slice(doc.search(/^(?:data|stringData):$/m));

// #946: a pre-install/pre-upgrade hook runs before Helm creates or updates the
// release's own ConfigMap and Secret, so a hook job must load its env from
// hook-scoped copies that exist, with this render's values, before it runs.
const hookEnvIsCurrent = (out, secretName) => {
  const cm = manifest(out, "ConfigMap", "p-portalai-hook-config");
  // Deleted once the phase succeeds (#946 review): a hook object outlives
  // `helm uninstall`, and the Secret carries credentials.
  const isEarlyHook = (doc) =>
    doc.includes('"helm.sh/hook": pre-install,pre-upgrade') &&
    doc.includes('"helm.sh/hook-weight": "-10"') &&
    doc.includes(
      '"helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded\n'
    );
  const secretOk =
    secretName === "p-portalai-hook-secret"
      ? isEarlyHook(manifest(out, "Secret", secretName)) &&
        dataOf(manifest(out, "Secret", secretName)) ===
          dataOf(manifest(out, "Secret", "p-portalai-secret"))
      : manifest(out, "Secret", "p-portalai-hook-secret") === "";
  return (
    isEarlyHook(cm) &&
    dataOf(cm) === dataOf(manifest(out, "ConfigMap", "p-portalai-config")) &&
    secretOk
  );
};

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
      name: "notes: bundled issuer + public object storage (#946)",
      args: [
        ...BUNDLED_ISSUER_ARGS,
        "--set",
        "objectStorage.publicHost=s3.example.com",
      ],
      assertions: [
        [
          "says where to sign in and how to read the admin password",
          (n) =>
            flat(n).includes("http://auth.example.com/realms/portalai") &&
            flat(n).includes("get secret p-portalai-keycloak"),
        ],
        [
          "no uploads warning once the object store has a public host",
          (n) => !flat(n).includes("File uploads need objectStorage.publicHost"),
        ],
      ],
    },
    {
      name: "notes: bundled object storage without a public host (#946)",
      args: [],
      assertions: [
        [
          "warns that uploads need objectStorage.publicHost",
          (n) => flat(n).includes("File uploads need objectStorage.publicHost"),
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
    name: "custom basemap with an upper-case scheme (#910)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      "--set",
      "web.basemap.mode=custom",
      "--set",
      "web.basemap.styleUrl=HTTPS://tiles.corp.example/style.json",
    ],
    assertions: [
      [
        "accepted, as the SPA's reader accepts it",
        (out) =>
          out.includes(
            'BASEMAP_STYLE_URL: "HTTPS://tiles.corp.example/style.json"'
          ),
      ],
    ],
  },
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
        // #946 review: with the object-storage component the s3 Service
        // selected the Job's pod (Ready, listening on nothing) as an endpoint.
        "bucket Job's pod isn't selected by the s3 Service (#946)",
        (out) => {
          const job = manifest(out, "Job", "p-portalai-s3-bucket");
          return (
            job !== "" &&
            !/app\.kubernetes\.io\/component: object-storage\n/.test(job) &&
            job.includes("app.kubernetes.io/component: object-storage-bucket\n")
          );
        },
      ],
      [
        // #946 review: the checksum hashed only the secret key, so renaming
        // the bucket (which the identity is scoped to) never restarted the
        // server, which reads s3.json only at start.
        "object storage rolls when its identity's bucket changes (#946)",
        (out) => {
          const sum = (o) =>
            /checksum\/identities: (\S+)/.exec(
              manifest(o, "StatefulSet", "p-portalai-s3")
            )?.[1];
          const renamed = run([
            "template",
            "p",
            CHART,
            ...IMAGE_ARGS,
            "--set",
            "objectStorage.bucket=renamed-uploads",
            "--set",
            "objectStorage.auth.secretKey=fixed",
          ]);
          const same = run([
            "template",
            "p",
            CHART,
            ...IMAGE_ARGS,
            "--set",
            "objectStorage.auth.secretKey=fixed",
          ]);
          return !!sum(same) && sum(same) !== sum(renamed);
        },
      ],
      [
        // #946 adversarial: `weed server` defaults to 8 volume slots and 30 GB
        // volumes; its internal collection took 7 and the bucket the last, so a
        // renamed bucket had nowhere to grow (500 "No writable volumes").
        "object storage sizes volume slots from its disk (#946)",
        (out) => {
          const sts = manifest(out, "StatefulSet", "p-portalai-s3");
          return (
            sts.includes("- -volume.max=0\n") &&
            sts.includes("- -master.volumeSizeLimitMB=512\n")
          );
        },
      ],
      [
        // #946 review: a word match took portalai-uploads-old for the bucket.
        "bucket Job matches the bucket name exactly (#946)",
        (out) =>
          manifest(out, "Job", "p-portalai-s3-bucket").includes(
            `awk '{print $1}' | grep -qxF "portalai-uploads"`
          ),
      ],
      [
        // Found on the live install: without it the API creates no users
        // (createdBy undefined), so every first sign-in answered 500.
        "SYSTEM_ID is the migrations' system principal, once (#946)",
        (out) => {
          const ids = configValues(out, "SYSTEM_ID");
          return ids.length === 1 && ids[0] === "SYSTEM";
        },
      ],
      [
        "api reads env from ConfigMap + Secret",
        (out) =>
          out.includes("configMapRef:") && out.includes("secretRef:"),
      ],
      [
        "bundled DATABASE_URL points at the postgresql service",
        (out) =>
          /DATABASE_URL: "postgresql:\/\/[^"]*@p-portalai-postgresql:5432\//.test(
            out
          ),
      ],
      [
        "bundled REDIS_URL points at the redis service",
        (out) => out.includes('REDIS_URL: "redis://p-portalai-redis:6379"'),
      ],
      [
        "bundled deps are the chart's own StatefulSets (#946)",
        (out) =>
          ["p-portalai-postgresql", "p-portalai-redis", "p-portalai-s3"].every(
            (name) => manifest(out, "StatefulSet", name) !== ""
          ),
      ],
      [
        "bundled DB runs PostGIS",
        (out) =>
          manifest(out, "StatefulSet", "p-portalai-postgresql").includes(
            'image: "imresamu/postgis:17-3.5"'
          ),
      ],
      [
        "bundled object storage runs SeaweedFS (#946)",
        (out) =>
          manifest(out, "StatefulSet", "p-portalai-s3").includes(
            'image: "chrislusf/seaweedfs:'
          ),
      ],
      [
        "no image from Bitnami or MinIO, and none floating on latest (#946)",
        (out) => {
          const all = images(out);
          return (
            all.length > 0 &&
            all.every(
              (img) =>
                !/(^|\/)(bitnami|bitnamilegacy|minio)\//.test(img) &&
                /:[^/]+$/.test(img) &&
                !img.endsWith(":latest")
            )
          );
        },
      ],
      [
        "bundled Redis stays plaintext: no REDIS_TLS_CA (#852)",
        (out) => !out.includes("REDIS_TLS_CA"),
      ],
      [
        "every bundled dep keeps its data on a volume claim",
        (out) =>
          ["p-portalai-postgresql", "p-portalai-redis", "p-portalai-s3"].every(
            (name) =>
              manifest(out, "StatefulSet", name).includes(
                "volumeClaimTemplates:"
              )
          ),
      ],
      [
        "bundled DB: first-install migrate is a plain Job that waits for the DB, not a pre-install hook (#946)",
        (out) => {
          const job = manifest(out, "Job", "p-portalai-migrate");
          return (
            job.includes('command: ["node", "dist/scripts/db-migrate.js"]') &&
            !job.includes('"helm.sh/hook"') &&
            hasInitContainer(job, "wait-for-db")
          );
        },
      ],
      [
        // Found on the live install: the wait runs as uid 1000, which has no
        // passwd entry in the postgres image, so pg_isready without -U can't
        // pick a user and never attempts a connection ("no attempt").
        "bundled DB: the migrate wait names its user (#946)",
        (out) =>
          /pg_isready -U portalai /.test(
            manifest(out, "Job", "p-portalai-migrate")
          ),
      ],
      [
        // Found on the live install: the image's USER is the name `nginx`,
        // and runAsNonRoot refuses a non-numeric user it can't verify.
        "web pod runs as a numeric non-root user (nginx-unprivileged's 101)",
        (out) =>
          /runAsUser: 101\n/.test(manifest(out, "Deployment", "p-portalai-web")),
      ],
      [
        "bundled DB: the API and the seed wait for the migrations (#946)",
        (out) =>
          hasInitContainer(
            manifest(out, "Deployment", "p-portalai-api"),
            "wait-for-migrations"
          ) &&
          hasInitContainer(
            manifest(out, "Job", "p-portalai-seed"),
            "wait-for-migrations"
          ),
      ],
      [
        "seed hook: post-install + command",
        (out) =>
          out.includes('"helm.sh/hook": post-install') &&
          out.includes('command: ["node", "dist/db/seed.js"]'),
      ],
      [
        "bundled object storage: a hook creates the bucket (#946)",
        (out) => {
          const job = manifest(out, "Job", "p-portalai-s3-bucket");
          return (
            job.includes('"helm.sh/hook": post-install,post-upgrade') &&
            job.includes("s3.bucket.create -name portalai-uploads")
          );
        },
      ],
      [
        "bundled object storage: the API signs with its credentials (#946)",
        (out) => {
          const api = manifest(out, "Deployment", "p-portalai-api");
          return ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"].every((key) =>
            new RegExp(
              `- name: ${key}\\n\\s+valueFrom:\\n\\s+secretKeyRef:\\n\\s+name: p-portalai-s3\\n`
            ).test(api)
          );
        },
      ],
      [
        "bundled object storage: no public host, so the in-cluster endpoint",
        (out) =>
          out.includes('UPLOAD_S3_ENDPOINT: "http://p-portalai-s3:8333"'),
      ],
      [
        // Found on the live install: a value added on upgrade (SYSTEM_ID)
        // never reached the upgrade's seed, which read the previous release's
        // ConfigMap.
        "upgrade job reads hook env that carries this render's values (#946)",
        (out) =>
          hookEnvIsCurrent(out, "p-portalai-hook-secret") &&
          envFromNames(manifest(out, "Job", "p-portalai-upgrade")).join() ===
            "p-portalai-hook-config,p-portalai-hook-secret",
      ],
      [
        // The README's upgrade signal is the job's log; deleting the job on
        // success left nothing to read.
        "hook jobs are kept after success, replaced on the next run (#946)",
        (out) =>
          ["p-portalai-upgrade", "p-portalai-seed"].every((job) =>
            manifest(out, "Job", job).includes(
              '"helm.sh/hook-delete-policy": before-hook-creation\n'
            )
          ),
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
              doc.includes("name: p-portalai-postgresql\n") &&
              doc.includes("key: postgres-password") &&
              doc.includes("name: MIGRATE_DATABASE_PASSWORD") &&
              doc.includes(
                'value: "postgresql://postgres@p-portalai-postgresql:5432/portalai"'
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
    name: "bundled issuer (#946)",
    args: ["template", "p", CHART, ...IMAGE_ARGS, ...BUNDLED_ISSUER_ARGS],
    assertions: [
      [
        "Keycloak runs from the official image",
        (out) =>
          manifest(out, "StatefulSet", "p-portalai-keycloak").includes(
            'image: "quay.io/keycloak/keycloak:'
          ),
      ],
      [
        "Keycloak serves its public host and imports the realm",
        (out) => {
          const kc = manifest(out, "StatefulSet", "p-portalai-keycloak");
          return (
            kc.includes("--hostname=http://auth.example.com") &&
            kc.includes("--import-realm")
          );
        },
      ],
      [
        "the realm grants the SPA's origin, PKCE and the API audience",
        (out) => {
          const realm = JSON.parse(
            /realm\.json: \|-?\n([\s\S]*?)(?=\n\S|\n---|$)/.exec(
              manifest(out, "ConfigMap", "p-portalai-keycloak-realm")
            )?.[1] ?? "null"
          );
          const client = realm?.clients?.find(
            (c) => c.clientId === "portalai-web"
          );
          return (
            realm?.realm === "portalai" &&
            realm.registrationAllowed === false &&
            client?.publicClient === true &&
            client.redirectUris.includes("http://app.example.com") &&
            client.webOrigins.includes("http://app.example.com") &&
            client.attributes["pkce.code.challenge.method"] === "S256" &&
            client.optionalClientScopes.includes("offline_access") &&
            client.defaultClientScopes.includes("email") &&
            client.protocolMappers.some(
              (m) =>
                m.protocolMapper === "oidc-audience-mapper" &&
                m.config["included.custom.audience"] === "portalai-api"
            )
          );
        },
      ],
      [
        "OIDC_* default from the bundled issuer",
        (out) =>
          configValues(out, "OIDC_ISSUER").join() ===
            "http://auth.example.com/realms/portalai" &&
          configValues(out, "OIDC_AUDIENCE").join() === "portalai-api" &&
          configValues(out, "OIDC_CLIENT_ID").join() === "portalai-web",
      ],
      [
        "the ingress routes the issuer host to Keycloak",
        (out) =>
          /host: "auth\.example\.com"[\s\S]*?name: p-portalai-keycloak\n/.test(
            manifest(out, "Ingress", "p-portalai")
          ),
      ],
    ],
  },
  {
    name: "explicit oidc.* beats the bundled issuer (#946)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      ...BUNDLED_ISSUER_ARGS,
      "--set",
      "oidc.issuer=https://idp.corp.example/realms/x",
      "--set",
      "oidc.audience=corp-api",
      "--set",
      "oidc.clientId=corp-web",
    ],
    assertions: [
      [
        "the explicit values render, once each",
        (out) =>
          configValues(out, "OIDC_ISSUER").join() ===
            "https://idp.corp.example/realms/x" &&
          configValues(out, "OIDC_AUDIENCE").join() === "corp-api" &&
          configValues(out, "OIDC_CLIENT_ID").join() === "corp-web",
      ],
    ],
  },
  {
    name: "bundled object storage on a public host (#946)",
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
      "objectStorage.publicHost=s3.example.com",
    ],
    assertions: [
      [
        "presigned URLs carry the public host",
        (out) => out.includes('UPLOAD_S3_ENDPOINT: "http://s3.example.com"'),
      ],
      [
        "the ingress routes it to the object store",
        (out) =>
          /host: "s3\.example\.com"[\s\S]*?name: p-portalai-s3\n[\s\S]*?number: 8333/.test(
            manifest(out, "Ingress", "p-portalai")
          ),
      ],
    ],
  },
  {
    // #946 review: "external" refuses plain http from a public client IP,
    // so sign-in was impossible on any http install but a private network.
    name: "bundled issuer realm's TLS requirement follows ingress TLS (#946)",
    args: ["template", "p", CHART, ...IMAGE_ARGS, ...BUNDLED_ISSUER_ARGS],
    assertions: [
      [
        "http ingress: sslRequired none",
        (out) =>
          /"sslRequired": "none"/.test(
            manifest(out, "ConfigMap", "p-portalai-keycloak-realm")
          ),
      ],
      [
        "TLS ingress: sslRequired external",
        () =>
          /"sslRequired": "external"/.test(
            manifest(
              run([
                "template",
                "p",
                CHART,
                ...IMAGE_ARGS,
                ...BUNDLED_ISSUER_ARGS,
                "--set",
                "ingress.tls.enabled=true",
                "--set",
                "ingress.tls.secretName=tls",
              ]),
              "ConfigMap",
              "p-portalai-keycloak-realm"
            )
          ),
      ],
    ],
  },
  {
    name: "hooks disabled (external DB)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      ...EXTERNAL_ARGS,
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
    name: "existingSecret (#946)",
    args: [
      "template",
      "p",
      CHART,
      ...IMAGE_ARGS,
      ...EXTERNAL_ARGS,
      "--set",
      "existingSecret=operator-env",
    ],
    assertions: [
      [
        "hook jobs read the operator's Secret; no chart copy renders",
        (out) =>
          hookEnvIsCurrent(out, "operator-env") &&
          ["p-portalai-migrate", "p-portalai-upgrade"].every(
            (job) =>
              envFromNames(manifest(out, "Job", job)).join() ===
              "p-portalai-hook-config,operator-env"
          ),
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
        "no bundled dep objects render",
        (out) =>
          !out.includes("kind: StatefulSet") &&
          !out.includes("p-portalai-postgresql") &&
          !out.includes("p-portalai-redis") &&
          !out.includes("p-portalai-s3"),
      ],
      [
        "external DB: migrate stays a pre-install hook, with no waits",
        (out) => {
          const job = manifest(out, "Job", "p-portalai-migrate");
          return (
            job.includes('"helm.sh/hook": pre-install\n') &&
            !job.includes("initContainers:") &&
            !manifest(out, "Deployment", "p-portalai-api").includes(
              "initContainers:"
            )
          );
        },
      ],
      [
        // The release's ConfigMap and Secret don't exist yet during
        // pre-install, so the migrate hook can't load env from them.
        "external DB: the pre-install migrate reads the hook env (#946)",
        (out) =>
          hookEnvIsCurrent(out, "p-portalai-hook-secret") &&
          envFromNames(manifest(out, "Job", "p-portalai-migrate")).join() ===
            "p-portalai-hook-config,p-portalai-hook-secret" &&
          manifest(out, "Job", "p-portalai-migrate").includes(
            '"helm.sh/hook-delete-policy": before-hook-creation\n'
          ),
      ],
      [
        "external object storage: credentials are the operator's, not the chart's",
        (out) =>
          !manifest(out, "Deployment", "p-portalai-api").includes(
            "AWS_ACCESS_KEY_ID"
          ),
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
