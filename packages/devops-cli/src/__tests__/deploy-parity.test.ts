/**
 * Deploy-surface parity guard (#382).
 *
 * `GEOCODING_API_KEY` (#315) was added to `backend.yml`, to `deploy-dev.yml`,
 * to `.env.example` and to the repo secrets — and missed in `catalog.ts`, the
 * one file whose omission has no deploy-time failure mode. `portalops vars`
 * therefore reported a complete environment while a required secret was
 * absent from its own inventory. Nothing would have caught the next one.
 *
 * Two subset assertions, deliberately NOT equality in either direction:
 *
 *   1. Every secret the task definition consumes is in the catalog. The
 *      catalog legitimately holds more — SUPPORT/SALES/ADMIN_EMAIL are baked
 *      into the web and site bundles at build time, and AUTH0_CLI_CLIENT_ID
 *      is read only by `portalai login`. None reaches the API container.
 *
 *   2. Every required `SecretArn*` parameter is passed by every workflow that
 *      deploys the stack. A parameter with a Default is optional by
 *      construction, so only defaultless ones are required.
 *
 * The catalog's membership rule, so the next omission is legible: a variable
 * belongs in CATALOG **iff** it is an operator-settable per-environment value
 * stored in Secrets Manager or SSM. Template-computed values (REDIS_URL, the
 * UPLOAD_S3_* trio, the redirect URIs) are correctly absent.
 */

import fs from "node:fs";
import path from "node:path";

import { parseDocument } from "yaml";

import { BUILTIN_ENVIRONMENTS } from "@portalai/cli-env";

import { CATALOG, pathFor } from "../catalog.js";

/** Walk up from cwd to the repo root — jest may run from either the package
 *  directory or the monorepo root depending on the invoking script. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "infra/cloudformation/backend.yml")))
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("repo root not found from " + process.cwd());
}

const ROOT = repoRoot();
const BACKEND_YML = path.join(ROOT, "infra/cloudformation/backend.yml");

/** Only the shape this guard reads — the template is far larger. */
interface ContainerDefinition {
  Environment: unknown;
  Secrets: unknown;
}
interface BackendTemplate {
  Parameters: Record<string, { Default?: unknown }>;
  Resources: {
    TaskDefinition: {
      Properties: { ContainerDefinitions: ContainerDefinition[] };
    };
  };
}

/** CloudFormation's short tags (!Sub, !Ref, !If, …) parse cleanly here —
 *  `yaml` keeps unknown tags rather than throwing. */
function loadTemplate(): BackendTemplate {
  const doc = parseDocument(fs.readFileSync(BACKEND_YML, "utf8"), {
    logLevel: "silent",
  });
  expect(doc.errors).toHaveLength(0);
  return doc.toJS({ maxAliasCount: -1 }) as BackendTemplate;
}

/** Collect every `Name` at any depth. A conditional entry (`!If [Cond, {…},
 *  AWS::NoValue]`) parses to an array, so a flat `.map(e => e.Name)` would
 *  silently skip it — which is exactly how GITHUB_DISPATCH_TOKEN is declared. */
function collectNames(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectNames(child, found);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "Name" && typeof value === "string") found.push(value);
      else collectNames(value, found);
    }
  }
  return found;
}

function container(): ContainerDefinition {
  const tpl = loadTemplate();
  return tpl.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
}

/** Every workflow that deploys backend.yml, by file name → contents. */
function backendDeployWorkflows(): Array<[string, string]> {
  const dir = path.join(ROOT, ".github/workflows");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(
      (f) => [f, fs.readFileSync(path.join(dir, f), "utf8")] as [string, string]
    )
    .filter(([, body]) => body.includes("infra/cloudformation/backend.yml"));
}

describe("every secret backend.yml consumes is in the portalops catalog (#382)", () => {
  const cataloged = new Set(CATALOG.map((e) => e.key));

  it("covers the task definition's Secrets block", () => {
    const names = collectNames(container().Secrets);
    expect(names.length).toBeGreaterThan(0);

    const missing = names.filter((n) => !cataloged.has(n));
    expect(missing).toEqual([]);
  });

  it("finds the conditionally-declared secrets too", () => {
    // Regression pin: GITHUB_DISPATCH_TOKEN is behind !If, and a naive
    // collector drops it — which would leave a hole in the guard itself.
    expect(collectNames(container().Secrets)).toContain(
      "GITHUB_DISPATCH_TOKEN"
    );
  });

  it("does not require the catalog to be a mirror", () => {
    // Build-time and CLI-only keys are catalog members with no container
    // presence. Asserting equality here would force them into the task
    // definition, which is the opposite of correct.
    const containerNames = new Set(collectNames(container().Secrets));
    for (const key of [
      "SUPPORT_EMAIL",
      "SALES_EMAIL",
      "ADMIN_EMAIL",
      "AUTH0_CLI_CLIENT_ID",
    ]) {
      expect(cataloged.has(key)).toBe(true);
      expect(containerNames.has(key)).toBe(false);
    }
  });
});

describe("every required SecretArn parameter is passed by each backend deploy (#382)", () => {
  const tpl = loadTemplate();
  const required = Object.entries(tpl.Parameters)
    .filter(
      ([name, def]) => name.startsWith("SecretArn") && def.Default === undefined
    )
    .map(([name]) => name);

  it("declares at least one required secret parameter", () => {
    expect(required.length).toBeGreaterThan(0);
  });

  it.each(backendDeployWorkflows())("%s passes them all", (_file, body) => {
    const unpassed = required.filter((p) => !body.includes(`${p}=`));
    expect(unpassed).toEqual([]);
  });
});

// #383: the ALB listener's certificate moved from an Fn::ImportValue to a
// required, defaultless parameter, so frontend.yml, site.yml and backend.yml
// all take it the same way. Defaultless is deliberate — a default would let a
// genuinely missing value deploy the WRONG certificate silently — which makes
// this assertion load-bearing: a workflow that never passes it cannot CREATE
// that environment's backend stack.
//
// Scoped to the invocation, not the file: deploy-dev.yml passes CertificateArn
// to the frontend and site stacks too, so a whole-file grep passes without
// guarding anything.
describe("every backend deploy passes the ALB certificate (#383)", () => {
  it("declares CertificateArn as a required parameter", () => {
    const tpl = loadTemplate();
    expect(tpl.Parameters.CertificateArn).toBeDefined();
    expect(tpl.Parameters.CertificateArn.Default).toBeUndefined();
  });

  it.each(backendDeployWorkflows())(
    "%s supplies it where the backend stack is created",
    (_file, body) => {
      // `aws cloudformation deploy` reuses a stack's existing values for
      // parameters it does not override, so only the CREATE invocation must
      // carry it — hence "at least one", not "every".
      const backendDeploys = body
        .split("aws cloudformation deploy")
        .slice(1)
        .filter((chunk) => chunk.includes("infra/cloudformation/backend.yml"));

      expect(backendDeploys.length).toBeGreaterThan(0);
      expect(backendDeploys.some((c) => c.includes("CertificateArn="))).toBe(
        true
      );
    }
  );
});

// #383: the production pipeline's invariants.
//
// CloudFormation has no unit-test surface, so the testable contract is the
// workflow — and specifically the three dev-only steps prod must NOT copy.
// Absence is invisible in review: a future contributor "restoring parity"
// between the two files is the predictable failure, and a comment does not
// stop them. These do.
describe("deploy-prod.yml invariants (#383)", () => {
  const PROD_WORKFLOW = path.join(ROOT, ".github/workflows/deploy-prod.yml");
  const body = (): string => {
    expect(fs.existsSync(PROD_WORKFLOW)).toBe(true);
    return fs.readFileSync(PROD_WORKFLOW, "utf8");
  };

  /** The workflow with full-line comments stripped.
   *
   *  Absence assertions MUST run against this, not the raw text: the file
   *  documents each deliberate omission by name, so `not.toContain(...)`
   *  against the raw body fails on the very comment that explains why the
   *  thing is absent. */
  const code = (): string =>
    body()
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");

  /** The text of each `aws cloudformation deploy` that targets a template. */
  const deploysOf = (template: string): string[] =>
    body()
      .split("aws cloudformation deploy")
      .slice(1)
      .filter((chunk) => chunk.includes(`infra/cloudformation/${template}`));

  it("targets prod on every stack deploy, and dev on none", () => {
    const chunks = body().split("aws cloudformation deploy").slice(1);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const head = chunk.slice(
        0,
        chunk.indexOf("--no-fail-on-empty-changeset")
      );
      expect(head).toContain("Environment=prod");
      expect(head).not.toContain("Environment=dev");
    }
    // It may READ a dev-named stack — the wildcard certificate lives in one
    // by design — but it must never DEPLOY one.
    expect(code()).not.toMatch(/--stack-name\s+portalai-dev-/);
  });

  it("passes the subdomains explicitly — dev rides the defaults", () => {
    // frontend.yml defaults to app-dev and backend.yml to api-dev, so an
    // omission here silently deploys production onto the dev hostnames.
    expect(deploysOf("frontend.yml").join()).toContain("Subdomain=app");
    expect(deploysOf("backend.yml").join()).toContain("Subdomain=api");
  });

  it("hardens the database: retention >= 14, deletion protection", () => {
    const db = deploysOf("database.yml").join();
    expect(db).toContain("DeletionProtection=true");
    const retention = /BackupRetentionPeriod=(\d+)/.exec(db);
    expect(retention).not.toBeNull();
    expect(Number(retention![1])).toBeGreaterThanOrEqual(14);
  });

  it("sets MultiAZ explicitly rather than inheriting the template default", () => {
    // Deliberately not pinned to `true`. #383's spec specified Multi-AZ; the
    // launch deploy runs single-AZ as a recorded cost deviation, and it is
    // expected to flip back before real traffic. What must NOT happen is the
    // parameter being dropped — `database.yml` defaults MultiAZ to "false",
    // so an omission silently reads as a deliberate choice. Forcing it to be
    // stated keeps the decision visible in the diff either way.
    expect(deploysOf("database.yml").join()).toMatch(/MultiAZ=(true|false)/);
  });

  it("gives prod a replicated Redis, not a single node", () => {
    expect(deploysOf("cache.yml").join()).toContain("ReplicationEnabled=true");
  });

  it("does NOT deploy the domain-wide mail DNS stack", () => {
    // portalai-dns-email carries one zone's MX/SPF/DMARC records and is
    // owned by the dev pipeline. A prod copy would fight it over the same
    // records.
    expect(deploysOf("dns-email.yml")).toHaveLength(0);
    expect(code()).not.toContain("portalai-dns-email");
  });

  it("does NOT seed placeholder contact addresses", () => {
    // #319 leaves prod fail-closed on purpose. Seeding would publish a
    // qa@ placeholder on the public marketing site.
    expect(code()).not.toMatch(/ssm put-parameter[\s\S]{0,200}-email/);
    expect(code()).not.toContain("qa@portalsai.io");
  });

  it("has no tag-deploy job — the release tag is already the marker", () => {
    expect(code()).not.toContain("tag-deploy");
  });

  it("serializes deploys without aborting a running migration", () => {
    expect(body()).toMatch(/group:\s*deploy-prod/);
    expect(body()).toMatch(/cancel-in-progress:\s*false/);
  });

  it("bootstraps the first deploy with a zero desired count", () => {
    // The deadlock this avoids: backend.yml creates the ECR repository AND
    // the ECS service, so on a fresh environment the service starts against
    // an empty registry, the circuit breaker rolls the stack back, and the
    // job that would have pushed the image never runs.
    expect(body()).toContain("DesiredCount=");
    expect(body()).toMatch(/ecr describe-images/);
  });
});

// #383: every CloudFormation export a workflow reads must actually be
// exported by a template.
//
// Written because it caught a real one: deploy-prod.yml asked for
// `prod-FrontendBucket` when the export is `prod-FrontendBucketName`. The
// failure mode is quiet and late — `describe-stacks` returns an empty string
// rather than erroring, so the deploy proceeds and `s3 sync` runs against
// `s3://`, mid-release, in production.
describe("workflows only read exports that templates declare (#383)", () => {
  const templateExports = (): Set<string> => {
    const dir = path.join(ROOT, "infra/cloudformation");
    const suffixes = new Set<string>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
      const body = fs.readFileSync(path.join(dir, file), "utf8");
      for (const m of body.matchAll(
        /Name:\s*!Sub\s*"\$\{Environment\}-([A-Za-z0-9]+)"/g
      )) {
        suffixes.add(m[1]);
      }
    }
    return suffixes;
  };

  const workflows = (): Array<[string, string]> => {
    const dir = path.join(ROOT, ".github/workflows");
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yml"))
      .map(
        (f) =>
          [f, fs.readFileSync(path.join(dir, f), "utf8")] as [string, string]
      );
  };

  it("finds the export suffixes the templates declare", () => {
    expect(templateExports().size).toBeGreaterThan(5);
  });

  it.each(workflows())("%s reads only real exports", (_file, body) => {
    const declared = templateExports();
    const referenced = [
      ...body.matchAll(/ExportName=='(?:dev|prod)-([A-Za-z0-9]+)'/g),
    ].map((m) => m[1]);

    const unknown = referenced.filter((s) => !declared.has(s));
    expect(unknown).toEqual([]);
  });
});

// #384: prod coverage.
//
// The two suites above are environment-independent — they compare the catalog
// against the template, and re-running them per environment would assert
// nothing new. The risk prod actually introduces is different, and silent: an
// environment's AWS paths come from `aws.envName`, so a registry entry with
// the wrong envName would have prod reads and writes land on ANOTHER
// environment's secrets, with no error at any layer. That is what this pins.
describe("each environment's config paths are isolated (#384)", () => {
  const awsEnvs = Object.values(BUILTIN_ENVIRONMENTS).filter((e) => e.aws);

  it("includes prod among the environments under guard", () => {
    expect(awsEnvs.map((e) => e.name)).toContain("prod");
  });

  it("resolves every catalog key for every environment", () => {
    for (const env of awsEnvs) {
      for (const entry of CATALOG) {
        const resolved = pathFor(env, entry);
        expect(resolved).toContain(`/${env.aws!.envName}/`);
        expect(resolved.endsWith(entry.name)).toBe(true);
      }
    }
  });

  it("never resolves two environments to the same path", () => {
    const seen = new Map<string, string>();
    for (const env of awsEnvs) {
      for (const entry of CATALOG) {
        const resolved = pathFor(env, entry);
        const owner = seen.get(resolved);
        // A duplicate here means one env would read or WRITE another's
        // secrets — the failure mode a typo'd envName produces.
        expect(owner ?? env.name).toBe(env.name);
        seen.set(resolved, env.name);
      }
    }
    expect(seen.size).toBe(awsEnvs.length * CATALOG.length);
  });
});

// #386: prod owns no ACM certificate stack.
//
// #383 decided this: the apex and the wildcard share one DNS validation
// CNAME, so a second stack requesting the same names in the same hosted zone
// collides in Route 53 — dns-certs.yml's own comment records that collision
// biting one level down, at DomainValidationOptions. Prod therefore threads
// the EXISTING wildcard ARN into every stack that needs it.
//
// This is pinned rather than merely decided because deploy-static-site.yml
// carried a prod-only step creating exactly that second stack. It predated
// the decision and was justified by "prod has no stacks of its own yet",
// which #383 made false. Nothing but this test stops it coming back.
describe("prod has no certificate stack of its own (#386)", () => {
  const allWorkflows = (): Array<[string, string]> => {
    const dir = path.join(ROOT, ".github/workflows");
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .map(
        (f) =>
          [f, fs.readFileSync(path.join(dir, f), "utf8")] as [string, string]
      );
  };

  /** Comments name the omission to explain it; only executable text counts. */
  const code = (body: string): string =>
    body
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");

  it.each(allWorkflows())("%s never deploys a prod cert stack", (_f, body) => {
    expect(code(body)).not.toMatch(/--stack-name\s+portalai-prod-dns-certs/);
  });

  it("the prod site caller points at the stack that owns the certificate", () => {
    const caller = fs.readFileSync(
      path.join(ROOT, ".github/workflows/deploy-site-prod.yml"),
      "utf8"
    );
    expect(code(caller)).toMatch(/cert-stack:\s*portalai-dev-dns-certs/);
  });
});

// #387: prod is no longer "pending a ticket" in the reference docs.
//
// The exclusions ARE the decision, not a convenience. `pending #83` also
// appears in smoke docs — one signed off by name and date — and in the
// discovery/spec/plan set. Those are not stale: they record what was walked,
// or what was known, at a point in time. Rewriting them would falsify a
// signed artifact and destroy the only evidence of what was actually
// verified. Encoding that here means the next person to run the same grep
// finds the distinction already made for them.
describe("reference docs describe prod as real (#387)", () => {
  /** Records of a past walkthrough or a past decision. Never swept. */
  const isHistorical = (name: string): boolean =>
    /\.(smoke|discovery|spec|plan)\.md$/.test(name);

  /** Condensed tickets put design + smoke in one un-suffixed file, so they
   *  cannot be recognised by name — enumerated, each with its reason. */
  const DESIGN_DOCS: Record<string, string> = {
    "PROD_CLI_ACTIVATION.md": "#387's own design doc — it explains the rule",
    "PROD_MARKETING_SITE.md": "#386 condensed design + smoke",
    "PROD_TIER_CATALOG.md": "#325 condensed design + smoke",
    "DEPLOYED_ENV_CONFIG.md": "#382 condensed design + smoke",
  };

  const referenceDocs = (): Array<[string, string]> => {
    const dir = path.join(ROOT, "docs");
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => !isHistorical(f) && !(f in DESIGN_DOCS))
      .map(
        (f) =>
          [f, fs.readFileSync(path.join(dir, f), "utf8")] as [string, string]
      );
  };

  it("finds a plausible number of reference docs", () => {
    expect(referenceDocs().length).toBeGreaterThan(3);
  });

  it.each(referenceDocs())("%s does not defer prod to a ticket", (_f, body) => {
    expect(body).not.toContain("pending #83");
    expect(body).not.toMatch(/[Uu]nexercised until #83/);
  });

  it("CLAUDE.md does not describe prod as future", () => {
    const claude = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
    expect(claude).not.toMatch(/future\s+`?prod`?/);
  });
});

// #386: the static-site sync's two cache-control passes must stay symmetric.
//
// `aws s3 sync` skips objects whose size and mtime already match the local
// file. So if an extension is short-cached in the second pass but NOT excluded
// from the first, the first pass uploads it with `immutable` and the second
// pass silently declines to re-upload it — the `--include` is a no-op and the
// file is cached for a year. That is not a hypothetical: it is how
// /.well-known/microsoft-identity-association.json would have shipped.
describe("static-site sync passes are symmetric (#386)", () => {
  const body = (): string =>
    fs.readFileSync(
      path.join(ROOT, ".github/workflows/deploy-static-site.yml"),
      "utf8"
    );

  /** Extensions named by `--include "*.ext"` / `--exclude "*.ext"`.
   *  Scanned as plain strings — a constructed RegExp here needs three layers
   *  of escaping and gets it wrong silently. */
  const globbed = (flag: "include" | "exclude", text: string): string[] => {
    const needle = `--${flag} "*`;
    const found = new Set<string>();
    for (
      let i = text.indexOf(needle);
      i !== -1;
      i = text.indexOf(needle, i + 1)
    ) {
      const start = i + needle.length;
      const end = text.indexOf('"', start);
      if (end !== -1) found.add(text.slice(start, end));
    }
    return [...found];
  };

  const passes = (): { immutable: string; revalidate: string } => {
    const chunks = body().split("aws s3 sync");
    // Matched on the cache-control VALUE, not the words "immutable" /
    // "must-revalidate": those appear in the surrounding comments too, and
    // matching prose made this select the file preamble instead of a command.
    const immutable = chunks.find((c) => c.includes("max-age=31536000"));
    const revalidate = chunks.find((c) => c.includes("max-age=0"));
    expect(immutable).toBeDefined();
    expect(revalidate).toBeDefined();
    return { immutable: immutable!, revalidate: revalidate! };
  };

  it("finds both passes", () => {
    const { immutable, revalidate } = passes();
    expect(globbed("exclude", immutable).length).toBeGreaterThan(0);
    expect(globbed("include", revalidate).length).toBeGreaterThan(0);
  });

  it("every short-cached extension is excluded from the immutable pass", () => {
    const { immutable, revalidate } = passes();
    const shortCached = globbed("include", revalidate);
    const excludedFromImmutable = globbed("exclude", immutable);

    const wouldBeStuckImmutable = shortCached.filter(
      (ext) => !excludedFromImmutable.includes(ext)
    );
    expect(wouldBeStuckImmutable).toEqual([]);
  });

  it("short-caches .json — the identity-association file lives there", () => {
    expect(globbed("include", passes().revalidate)).toContain(".json");
  });
});
