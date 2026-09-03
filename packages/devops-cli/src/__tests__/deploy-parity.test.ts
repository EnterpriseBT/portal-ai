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
    //
    // The signal is whether the STACK exists. It used to probe ECR for any
    // image, which is a different question: the service starts the tag the
    // task definition names, and deploy-infra never sets ImageTag.
    expect(code()).toContain("DesiredCount=0");
    expect(code()).toMatch(/describe-stacks[\s\S]{0,120}portalai-prod-backend/);
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

// #83: two invariants the first production deploy taught us.
describe("prod deploy: release-only, and one-off tasks run the new image (#83)", () => {
  const prod = (): string =>
    fs.readFileSync(
      path.join(ROOT, ".github/workflows/deploy-prod.yml"),
      "utf8"
    );
  const code = (): string =>
    prod()
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");

  it("triggers on published releases only", () => {
    // A workflow_dispatch runs against a branch ref, so "what is in
    // production" degrades to "whatever main was at that moment" — which is
    // exactly what the release tag exists to pin down. Rollback re-runs a
    // previous release's run and does not need dispatch either.
    expect(code()).toMatch(/release:\s*\n\s*types:\s*\[published\]/);
    expect(code()).not.toMatch(/^\s*workflow_dispatch:/m);
  });

  it("registers a task definition carrying the freshly-built image", () => {
    const step = code().slice(code().indexOf("Register a migration task"));
    const body = step.slice(0, step.indexOf("- name: Snapshot"));
    expect(body).toContain("register-task-definition");
    // The image it registers must be the tag this run just pushed.
    expect(body).toContain('["image"]');
    expect(body).toContain(":prod-${{ github.sha }}");
  });

  it("runs every one-off task on that revision, never the service's", () => {
    // The bug this pins: migrate/seed used steps.ecs.outputs.task_def — the
    // SERVICE's current definition. On a first deploy that is a tag with no
    // image; on later deploys it is the PREVIOUS image, which carries the
    // previous release's migration files. Both fail quietly.
    const runTasks = code()
      .split("aws ecs run-task")
      .slice(1)
      .map((c) => c.slice(0, c.indexOf("--query")));
    expect(runTasks.length).toBeGreaterThanOrEqual(2);
    for (const t of runTasks) {
      expect(t).toContain("steps.migtd.outputs.arn");
      expect(t).not.toContain("steps.ecs.outputs.task_def");
    }
  });

  it("never scales the service from deploy-infra", () => {
    // deploy-infra does not set ImageTag, so the task definition keeps
    // whatever tag it had — `latest` on a fresh stack, which prod never
    // publishes. Scaling up from here means starting tasks against a tag that
    // may not exist: one run spent an hour failing to pull before rolling back.
    // Only deploy-backend, which has just pushed an image and sets ImageTag,
    // may set DesiredCount.
    const infra = code().slice(
      code().indexOf("deploy-infra:"),
      code().indexOf("deploy-frontend:")
    );
    expect(infra).not.toMatch(/DesiredCount=[1-9]/);
    // And it must not use "is there any image in ECR" as the signal — the
    // question is whether the stack exists, not whether a tag happens to be
    // present under some other name.
    expect(infra).not.toMatch(/ecr describe-images/);
  });

  it("sets image tag and scale together, after the seed", () => {
    const backend = code().slice(code().indexOf("deploy-backend:"));
    const finalDeploy = backend.slice(
      backend.lastIndexOf("aws cloudformation deploy")
    );
    expect(finalDeploy).toContain("ImageTag=prod-${{ github.sha }}");
    expect(finalDeploy).toMatch(/DesiredCount=[1-9]/);
    // The seed must precede it: code never rolls onto an un-migrated schema.
    expect(backend.indexOf("db:seed:ci")).toBeLessThan(
      backend.lastIndexOf("aws cloudformation deploy")
    );
  });

  it("prints stoppedReason when a one-off task fails", () => {
    // "Migration failed with exit code None" said nothing, and the task record
    // ages out within the hour — so the reason must be captured in the log at
    // failure time or it is lost.
    expect(code()).toContain("stoppedReason");
  });
});

// #403: §2 of the provisioning runbook creates the Auth0 SPA and the API as two
// independent checklist items and — until this ticket — never linked them, nor
// said that a social connection must carry its own OAuth credentials. Both gaps
// are invisible until a real user tries to log in, and both cost a production
// incident during #83's walk. Prose is the deliverable here, so prose is what
// gets pinned: an operator following the file must be told to authorize the
// pair, and told not to ship on Auth0's shared developer keys.
describe("provisioning runbook covers the Auth0 wiring (#403)", () => {
  const auth0Section = (): string => {
    const body = fs.readFileSync(
      path.join(ROOT, "docs/PROD_PROVISIONING.runbook.md"),
      "utf8"
    );
    const start = body.indexOf("## 2 — Auth0 tenant");
    expect(start).toBeGreaterThan(-1);
    const end = body.indexOf("\n## ", start + 1);
    return body.slice(start, end === -1 ? undefined : end);
  };

  it("tells the operator to authorize the SPA against the API", () => {
    // Creating both halves is not enough; the grant is a separate act.
    expect(auth0Section()).toMatch(/Authorize the SPA against the API/i);
  });

  it("names the error that a missing grant produces", () => {
    // The symptom is a dead Sign-in button, which points at the frontend. The
    // runbook has to connect that symptom to this cause or the next operator
    // debugs the wrong layer.
    const s = auth0Section();
    expect(s).toContain("not authorized to access resource server");
    expect(s).toMatch(/does nothing|address bar/i);
  });

  it("warns against Auth0's shared developer keys", () => {
    expect(auth0Section()).toMatch(/developer keys/i);
  });

  it("gives the redirect-host tell for developer keys", () => {
    // The client id looks equally plausible either way; the callback host is
    // the only reliable discriminator, so it must be spelled out.
    expect(auth0Section()).toContain("login.us.auth0.com/login/callback");
  });

  it("ships a terminal probe that runs before any deploy", () => {
    const body = fs.readFileSync(
      path.join(ROOT, "docs/PROD_PROVISIONING.runbook.md"),
      "utf8"
    );
    expect(body).toMatch(/Verify §2 from a terminal/i);
    // The probe's value is that each fault has a DISTINCT signature; a probe
    // that cannot separate them is the mistake this replaces.
    expect(body).toContain("Service not found");
    expect(body).toContain("code_challenge_method=S256");
  });
});

// #404: the apex (`portalsai.io`) is a PROD-ONLY concept, gated by a condition.
//
// Two failure modes are pinned here, and neither announces itself at deploy
// time. First, an unconditional apex alias would make the DEV distribution
// claim `portalsai.io` — CloudFront allows one distribution per alias, so dev
// would hold the production apex hostage and prod's deploy would be the thing
// that fails. Second, the apex redirect lives inside the SAME viewer-request
// function as the index rewrite (CloudFront permits one function per event
// type per behavior), so the two responsibilities are one edit away from
// being ordered wrongly — and a URI rewritten before the redirect puts
// `/index.html` in the Location header.
describe("the apex serves prod only, behind a condition (#404)", () => {
  const SITE_YML = path.join(ROOT, "infra/cloudformation/site.yml");

  const siteTemplate = (): {
    Parameters: Record<string, { Default?: string }>;
    Conditions?: Record<string, unknown>;
    // `Record<string, never>` made every nested read `never`, so any access
    // past a resource's first level was a type error waiting to be noticed —
    // which nothing did, because no CI job ran type-check until #427.
    Resources: Record<
      string,
      { Condition?: string; Properties?: Record<string, unknown> }
    >;
  } => {
    const doc = parseDocument(fs.readFileSync(SITE_YML, "utf8"), {
      logLevel: "silent",
    });
    expect(doc.errors).toHaveLength(0);
    return doc.toJS({ maxAliasCount: -1 });
  };

  const workflow = (f: string): string =>
    fs.readFileSync(path.join(ROOT, ".github/workflows", f), "utf8");

  /** Comments name the omission to explain it; only executable text counts. */
  const code = (body: string): string =>
    body
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");

  it("the prod caller claims the apex", () => {
    expect(code(workflow("deploy-site-prod.yml"))).toMatch(
      /apex-domain:\s*portalsai\.io/
    );
  });

  it("the dev caller does not — dev has no apex", () => {
    expect(code(workflow("deploy-site-dev.yml"))).not.toMatch(/apex-domain:/);
  });

  it("ApexDomain defaults to empty, so a caller that says nothing gets none", () => {
    // The dev caller passes no apex-domain at all (asserted above), so the
    // default IS the dev behavior. A non-empty default would silently give
    // dev an apex.
    const param = siteTemplate().Parameters.ApexDomain;
    expect(param).toBeDefined();
    expect(param.Default).toBe("");
  });

  it("the apex record set exists only under the condition", () => {
    const tpl = siteTemplate();
    expect(tpl.Conditions?.HasApex).toBeDefined();
    const record = tpl.Resources.ApexDnsRecord;
    expect(record).toBeDefined();
    expect(record.Condition).toBe("HasApex");
  });

  it("the apex alias is conditional, never a second unconditional entry", () => {
    const { DistributionConfig } = siteTemplate().Resources.SiteDistribution
      .Properties as { DistributionConfig: { Aliases: unknown } };
    const aliases = DistributionConfig.Aliases;
    // `!If [HasApex, …]` parses to an array carrying the condition name.
    expect(JSON.stringify(aliases)).toContain("HasApex");
  });

  // The function BEHAVIOR — the redirect target, the query string, the
  // ordering against the index rewrite — is covered by executing the real
  // extracted code in apps/site/scripts/__tests__/cloudfront-rewrite.test.ts,
  // which is that function's test home. What belongs HERE is the deploy
  // wiring above: which environment gets an apex at all.
});

// #424: the deployed task sizing must be STATED, and the V8 heap must be
// derived from it.
//
// app-dev ran at Cpu=256/Memory=512 for four months while backend.yml said
// 1024/8192. Neither backend deploy passed either parameter, and
// `aws cloudformation deploy` reuses whatever the stack was created with, so
// both template bumps were no-ops for that environment. Prod escaped only by
// timing — its stack was created after the defaults rose — which means prod
// carries the same latent bug, not an immunity.
//
// The compounding half is that `--max-old-space-size` was a LITERAL in the
// template body, so it deployed immediately and could not adapt: V8 was
// authorised to grow ~14x past a 512 MB cgroup, which turns a catchable heap
// error into a SIGKILL (exit 137, a bare 502 with no stack trace).
//
// Scoped deliberately to Cpu/Memory rather than "every parameter": omitting
// DesiredCount is INTENTIONAL on the prod create path (deploy-prod.yml's
// `scale` step, so a redeploy cannot scale the service down mid-flight).
describe("task sizing is stated, and the heap follows it (#424)", () => {
  const BACKEND_TEMPLATE = "infra/cloudformation/backend.yml";

  /** Each `aws cloudformation deploy` chunk that targets backend.yml. */
  const backendDeploys = (body: string): string[] =>
    body
      .split("aws cloudformation deploy")
      .slice(1)
      .filter((chunk) => chunk.includes(BACKEND_TEMPLATE));

  const template = (): {
    Parameters: Record<string, { Default?: unknown; AllowedValues?: number[] }>;
    Mappings?: Record<string, Record<string, { HeapMb?: number }>>;
    Resources: Record<string, never>;
  } => {
    const doc = parseDocument(fs.readFileSync(BACKEND_YML, "utf8"), {
      logLevel: "silent",
    });
    expect(doc.errors).toHaveLength(0);
    return doc.toJS({ maxAliasCount: -1 });
  };

  it.each(backendDeployWorkflows())(
    "%s states Cpu and Memory where the service is created",
    (_file, body) => {
      // "at least one", not "every" — `deploy` reuses recorded values, so only
      // the CREATE invocation must carry them. Same rule as CertificateArn.
      const chunks = backendDeploys(body);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => /\bCpu=/.test(c))).toBe(true);
      expect(chunks.some((c) => /\bMemory=/.test(c))).toBe(true);
    }
  );

  it("guards more than one environment", () => {
    // The precedent this extends (MultiAZ, :263) is prod-only, which is how
    // app-dev drifted unnoticed. If this ever sees one workflow, the guard has
    // silently narrowed back to where it started.
    expect(backendDeployWorkflows().length).toBeGreaterThanOrEqual(2);
  });

  it("derives the heap ceiling from Memory instead of hardcoding it", () => {
    // A literal cannot be wrong at deploy time the way a parameter can drift,
    // which is exactly how the two silently disagreed for four months.
    // Comment-stripped, per this file's convention: the Mappings comment
    // NAMES the old `7000` to explain what went wrong, and that history is
    // worth keeping. Only executable text counts.
    const yaml = fs
      .readFileSync(BACKEND_YML, "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(yaml).not.toMatch(/--max-old-space-size=\d+/);
    expect(yaml).toMatch(/max-old-space-size=\$\{[A-Za-z]/);
  });

  it("maps every allowed Memory value to a heap", () => {
    // CloudFormation has no arithmetic intrinsic, so the relationship is a
    // Mapping. !FindInMap FAILS the deploy on an unmapped size, so a sizing
    // whose heap nobody considered cannot ship — but only if AllowedValues
    // and the Mapping agree, which is what this asserts.
    const tpl = template();
    const allowed = tpl.Parameters.Memory.AllowedValues;
    expect(allowed).toBeDefined();
    expect(allowed!.length).toBeGreaterThan(0);

    const map = tpl.Mappings?.NodeHeapByMemory;
    expect(map).toBeDefined();
    for (const value of allowed!) {
      expect(map![String(value)]).toBeDefined();
      expect(typeof map![String(value)].HeapMb).toBe("number");
    }
  });

  it("keeps every mapped heap below its container", () => {
    // The invariant the bug violated: 7000 MB of heap inside 512 MB of
    // container. A heap at or above the ceiling is a SIGKILL waiting to
    // happen, so this is the assertion that must never go green while wrong.
    const map = template().Mappings!.NodeHeapByMemory;
    for (const [memory, entry] of Object.entries(map)) {
      expect(entry.HeapMb!).toBeLessThan(Number(memory));
    }
  });
});

/**
 * Skip-propagation guard (regression from #427).
 *
 * #427 made deploy-dev's test jobs conditional (a push to main was already
 * gated by the PR's checks against an identical tree) and gave `deploy-infra`
 * an `always()` so it could run past them. That worked. What it did not
 * anticipate: GitHub propagates the skip state *past* an `always()` job to
 * everything downstream, even though that job succeeds. `deploy-frontend`,
 * `deploy-backend` and `tag-deploy` were all skipped on the first real merge —
 * and the run still reported **success**. app-dev simply stopped receiving
 * code, with nothing red anywhere to say so.
 *
 * That is the worst shape a CI bug can take, so it gets a test rather than a
 * comment: in any workflow where some job is conditional, every job downstream
 * of it must state its own `if`. Inheriting the default is the bug.
 */
describe("conditional jobs do not silently skip their dependents (regression from #427)", () => {
  const DEPLOY_WORKFLOWS = ["deploy-dev.yml", "deploy-prod.yml"] as const;

  interface JobShape {
    needs?: string | string[];
    if?: unknown;
  }

  const jobsOf = (file: string): Record<string, JobShape> => {
    const doc = parseDocument(
      fs.readFileSync(path.join(ROOT, ".github/workflows", file), "utf8"),
      { logLevel: "silent" }
    );
    expect(doc.errors).toHaveLength(0);
    const parsed = doc.toJS({ maxAliasCount: -1 }) as {
      jobs: Record<string, JobShape>;
    };
    return parsed.jobs;
  };

  const needsOf = (job: JobShape): string[] =>
    job.needs === undefined
      ? []
      : Array.isArray(job.needs)
        ? job.needs
        : [job.needs];

  it.each(DEPLOY_WORKFLOWS)(
    "%s — every job downstream of a conditional job states its own `if`",
    (file) => {
      const jobs = jobsOf(file);
      const conditional = new Set(
        Object.entries(jobs)
          .filter(([, j]) => j.if !== undefined)
          .map(([name]) => name)
      );
      if (conditional.size === 0) return; // nothing conditional, nothing to leak

      // Walk the graph to a fixed point: a job is "tainted" when any job in its
      // transitive `needs` closure is conditional.
      const tainted = new Set<string>(conditional);
      for (let pass = 0; pass < Object.keys(jobs).length; pass++) {
        for (const [name, job] of Object.entries(jobs)) {
          if (needsOf(job).some((n) => tainted.has(n))) tainted.add(name);
        }
      }

      const unguarded = [...tainted].filter((n) => jobs[n]?.if === undefined);
      expect(unguarded).toEqual([]);
    }
  );

  it("deploy-dev's deploy jobs require deploy-infra to have SUCCEEDED", () => {
    const jobs = jobsOf("deploy-dev.yml");
    for (const name of ["deploy-frontend", "deploy-backend"]) {
      const cond = String(jobs[name]?.if ?? "");
      // The permissive `!contains(needs.*.result, 'failure')` form is wrong
      // here: on a dispatch with a failing suite, deploy-infra is *skipped*
      // rather than failed, and that form would deploy anyway.
      expect(cond).toContain("needs.deploy-infra.result == 'success'");
      expect(cond).not.toContain("contains(needs.*.result");
    }
  });
});

/**
 * Concurrency-group collision guard (regression from #427).
 *
 * The three test workflows are reachable two ways: directly on a branch push,
 * and by `workflow_call` from deploy-dev / deploy-prod. Inside a reusable
 * workflow every `github.*` context resolves to the CALLER — so a group built
 * from `github.workflow` + `github.run_id` is *identical* for all three suites
 * invoked by one deploy run. With `cancel-in-progress: true` they cancel each
 * other: the first manual dispatch cancelled Integration Tests and Static
 * Checks and left only Unit Tests standing.
 *
 * The fix is to lead the group with a per-workflow literal. These assertions
 * pin both halves of it, because the failure is invisible on the path people
 * actually exercise (branch pushes work fine either way) and only shows up on
 * a manual deploy or a prod release.
 */
describe("test workflows cannot cancel each other (regression from #427)", () => {
  const SUITES = ["unit-test", "integration-test", "static-checks"] as const;

  const concurrencyOf = (file: string): { group: string; cancel: unknown } => {
    const doc = parseDocument(
      fs.readFileSync(path.join(ROOT, ".github/workflows", file), "utf8"),
      { logLevel: "silent" }
    );
    expect(doc.errors).toHaveLength(0);
    const parsed = doc.toJS({ maxAliasCount: -1 }) as {
      concurrency: { group: string; "cancel-in-progress": unknown };
    };
    return {
      group: parsed.concurrency.group,
      cancel: parsed.concurrency["cancel-in-progress"],
    };
  };

  it.each(SUITES)(
    "%s.yml leads its group with its own literal name",
    (name) => {
      const { group, cancel } = concurrencyOf(`${name}.yml`);
      expect(cancel).toBe(true);
      expect(group.startsWith(`${name}-`)).toBe(true);
      // `github.workflow` is the caller's name in a reusable workflow, so it
      // cannot distinguish siblings — that is the bug this guards.
      expect(group).not.toContain("github.workflow");
    }
  );

  it("the three groups are pairwise distinct for a single caller run", () => {
    // Resolve the expression the way a `workflow_call` from one deploy run
    // would: same ref, same run_id, non-push event.
    const resolved = SUITES.map((name) =>
      concurrencyOf(`${name}.yml`)
        .group.replace(
          /\$\{\{ \(github\.event_name == 'push'.*?\}\}/,
          "RUN_ID_7"
        )
        .replace(/\$\{\{ github\.ref \}\}/, "refs/heads/main")
    );
    expect(new Set(resolved).size).toBe(SUITES.length);
  });

  it("still shares a group across runs of the same workflow on a branch", () => {
    // The cancellation this exists to deliver: same workflow, same ref, two
    // pushes. Nothing run-scoped may appear in that branch of the expression.
    const { group } = concurrencyOf("unit-test.yml");
    const branchArm = group.split("-${{ github.ref }}-")[1] ?? "";
    expect(branchArm).toContain("'branch'");
    expect(branchArm).toContain("github.run_id");
  });
});

/**
 * Shell line-continuation guard (#424 fallout).
 *
 * #429 documented the Cpu/Memory choice by putting a `#` comment block in the
 * middle of a `\`-continued `aws cloudformation deploy` argument list. bash
 * joins a continued line before parsing, so the `#` commented out the REST of
 * that logical line — truncating the invocation before `--capabilities` and
 * before Cpu/Memory were ever passed. Every deploy then failed with
 * `InsufficientCapabilitiesException`, and #429's own sizing fix never
 * reached app-dev. The same shape was in deploy-prod.yml, waiting for the
 * next release.
 *
 * It reviews as correct — the flag is right there in the file, three lines
 * below the comment. Only the shell disagrees. So it gets a test.
 */
describe("no shell comment sits inside a line continuation (#424)", () => {
  const WORKFLOW_DIR = path.join(ROOT, ".github/workflows");

  const offendersIn = (file: string): string[] => {
    const out: string[] = [];
    const lines = fs
      .readFileSync(path.join(WORKFLOW_DIR, file), "utf8")
      .split("\n");
    let continued = false;
    lines.forEach((line, i) => {
      const t = line.trim();
      if (continued && t.startsWith("#")) out.push(`${file}:${i + 1} ${t}`);
      continued = t.endsWith("\\");
    });
    return out;
  };

  it("holds for every workflow", () => {
    const files = fs
      .readdirSync(WORKFLOW_DIR)
      .filter((f) => f.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap(offendersIn)).toEqual([]);
  });

  it.each([
    ["deploy-dev.yml", "portalai-dev-backend"],
    ["deploy-prod.yml", "portalai-prod-backend"],
  ])("%s still passes --capabilities after line-joining", (file, stack) => {
    // Join continuations the way bash does, then look at the invocations that
    // actually target the backend stack — not every chunk that merely mentions
    // the word, which includes prose and the network/frontend stacks.
    const invocations = fs
      .readFileSync(path.join(WORKFLOW_DIR, file), "utf8")
      .replace(/\\\n\s*/g, " ")
      .split("aws cloudformation deploy")
      // Each chunk runs to the NEXT invocation, so its tail can mention other
      // stacks — deploy-prod.yml's frontend deploy is followed by a
      // `describe-stacks --stack-name portalai-prod-backend` guard. Anchor on
      // what the chunk STARTS with (the first flag after the command) rather
      // than on a substring anywhere inside it. `.slice(1)` drops the text
      // before the first invocation.
      .slice(1)
      .filter((c) => new RegExp(`^\\s*--stack-name ${stack}\\s`).test(c));
    expect(invocations.length).toBeGreaterThan(0);

    // Truncation drops the tail of the command, so `--capabilities` is the
    // canary: every backend deploy must still carry it.
    for (const inv of invocations) {
      expect(inv).toContain("--capabilities CAPABILITY_NAMED_IAM");
    }

    // Exactly one of them declares the sizing (the other inherits it while
    // rolling the image), and it must appear before the flags that follow it.
    const sizing = invocations.filter((inv) =>
      inv.split("--capabilities")[0].includes("Cpu=")
    );
    expect(sizing).toHaveLength(1);
    expect(sizing[0].split("--capabilities")[0]).toContain("Memory=");
  });
});

describe("rotation-proof db credentials wiring (#500)", () => {
  // The app's runtime password resolution silently depends on exactly two
  // infra lines; each pinned here so a template refactor can't drop them.

  it("injects DB_MASTER_SECRET_ARN as a plain env var (ImportValue from the database stack)", () => {
    expect(collectNames(container().Environment)).toContain(
      "DB_MASTER_SECRET_ARN"
    );
  });

  it("grants the TASK role (not just the execution role) GetSecretValue on rds!*", () => {
    // Raw-text assertion: CFN short tags (!Sub) don't reliably survive
    // toJS(), and what matters is the statement existing inside the
    // TaskManagedPolicy block specifically.
    const raw = fs.readFileSync(BACKEND_YML, "utf8");
    const start = raw.indexOf("TaskManagedPolicy:");
    const end = raw.indexOf("TaskRole:", start);
    expect(start).toBeGreaterThan(-1);
    const block = raw.slice(start, end);
    expect(block).toContain("secretsmanager:GetSecretValue");
    expect(block).toContain("secret:rds!*");
  });
});
