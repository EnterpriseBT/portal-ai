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

import { CATALOG } from "../catalog.js";

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
