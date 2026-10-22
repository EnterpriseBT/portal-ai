/**
 * #641: `created_by_system` means "the platform provisioned this". Ownership
 * is `createdBy`, and the system principal (`SystemUtilities.id.system`, or
 * the literal `"SYSTEM"` it resolves to outside prod) belongs only on platform
 * seeds, org-provisioned defaults, identity/billing housekeeping and
 * platform materializations. An object a user or an agent session created is
 * owned by that user, with an agent session recorded as `sourcePortalId`.
 *
 * Three rules, each failing CI:
 * 1. The system principal appears only in the allowlisted files below.
 * 2. Every session-creating tool is built with the session's `portalId`.
 * 3. Authorization never reads `sourcePortalId`: provenance isn't ownership.
 *
 * Scans every API source file as UTF-8 text, as permission-copy.guard does.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The system principal, by reference or as the literal it resolves to. */
export const SYSTEM_PRINCIPAL = /SystemUtilities\.id\.system|["']SYSTEM["']/;

/** Files that may write or read the system principal, and why. Shrink-only. */
const ALLOWED_SYSTEM: Array<{ file: string; reason: string }> = [
  {
    file: "services/seed.service.ts",
    reason:
      "platform seed: tiers, connector definitions, system column definitions, system roles and policies",
  },
  {
    file: "services/demo-seed.service.ts",
    reason: "fixture seed: the demo org's dataset",
  },
  { file: "db/seed-org.ts", reason: "fixture seed: the e2e and demo orgs" },
  {
    file: "services/application.service.ts",
    reason:
      "org provisioning: the org, owner membership, user rows and the provisioned defaults (Sandbox, My Station)",
  },
  {
    file: "services/seat.service.ts",
    reason: "identity housekeeping: seat user rows and role materialization",
  },
  {
    file: "services/tier-grant.service.ts",
    reason: "billing housekeeping: tier-grant updatedBy",
  },
  {
    file: "services/billing.service.ts",
    reason: "billing housekeeping: commercial events",
  },
  {
    file: "services/marketplace.service.ts",
    reason: "billing housekeeping: marketplace commercial events",
  },
  {
    file: "services/wide-table-reconciler.service.ts",
    reason: "platform materialization: wide-table column adds and retires",
  },
  {
    file: "queues/processors/dissolve-precompute.processor.ts",
    reason: "platform materialization: map dissolve geometries",
  },
  {
    file: "services/permission-set.ts",
    reason: "reads it to evaluate created_by_system",
  },
  {
    file: "config/swagger.config.ts",
    reason:
      "OpenAPI example createdBy on connector definitions, which are platform seeds",
  },
];

/** Tools that create a session-producible object. Each records the portal. */
export const SESSION_CREATING_TOOLS = [
  "EntityRecordCreateTool",
  "ConnectorEntityCreateTool",
  "FieldMappingCreateTool",
  "RoleCreateTool",
  "PolicyCreateTool",
  "GroupCreateTool",
  "CuratedViewCreateTool",
] as const;

/** Where authorization is decided; none of it may read provenance. */
const AUTHORIZATION_FILES = [
  "services/permission-set.ts",
  "services/permission.service.ts",
  "services/object-capabilities.service.ts",
  "services/object-access.service.ts",
];

/** Lines of `source` naming the system principal. */
export function systemPrincipalLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => SYSTEM_PRINCIPAL.test(line))
    .map((line) => line.trim());
}

/**
 * `new <Tool>().build(…)` calls in `source` for a session-creating tool whose
 * arguments never mention `portalId`.
 */
export function unthreadedSessionTools(source: string): string[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest);
  const missing: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "build" &&
      ts.isNewExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression)
    ) {
      const cls = node.expression.expression.expression.text;
      const threaded = node.arguments.some((a) =>
        a.getText(file).includes("portalId")
      );
      if (
        (SESSION_CREATING_TOOLS as readonly string[]).includes(cls) &&
        !threaded
      ) {
        missing.push(cls);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return missing;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("the system principal stays on platform seeds (#641)", () => {
  const files = sourceFiles(apiSrc).map((path) => ({
    path: relative(apiSrc, path),
    source: readFileSync(path, "utf8"),
  }));
  const source = (path: string) =>
    files.find((f) => f.path === path)?.source ?? "";

  it("scans the API source", () => {
    expect(files.length).toBeGreaterThanOrEqual(200);
    expect(source("services/tools.service.ts")).toContain(
      "buildAnalyticsTools"
    );
  });

  it("names the system principal only in allowlisted files", () => {
    const allowed = new Set(ALLOWED_SYSTEM.map((a) => a.file));
    const offenders = files
      .filter((f) => !allowed.has(f.path))
      .flatMap((f) =>
        systemPrincipalLines(f.source).map((line) => `${f.path}: ${line}`)
      );
    expect(offenders).toEqual([]);
  });

  it("every allowlisted file still names it (the list only shrinks)", () => {
    for (const a of ALLOWED_SYSTEM) {
      expect([a.file, systemPrincipalLines(source(a.file)).length > 0]).toEqual(
        [a.file, true]
      );
    }
  });

  it("builds every session-creating tool with the session's portalId", () => {
    const tools = source("services/tools.service.ts");
    expect(unthreadedSessionTools(tools)).toEqual([]);
    for (const cls of SESSION_CREATING_TOOLS) {
      expect([cls, tools.includes(`new ${cls}()`)]).toEqual([cls, true]);
    }
  });

  it("authorization never reads sourcePortalId", () => {
    for (const path of AUTHORIZATION_FILES) {
      expect([path, source(path).length > 0]).toEqual([path, true]);
      expect([path, source(path).includes("sourcePortalId")]).toEqual([
        path,
        false,
      ]);
    }
  });

  it("catches a system createdBy and an unthreaded session tool", () => {
    expect(
      systemPrincipalLines(`const row = { createdBy: "SYSTEM" };`)
    ).toHaveLength(1);
    expect(
      systemPrincipalLines("factory.create(SystemUtilities.id.system)")
    ).toHaveLength(1);
    expect(
      systemPrincipalLines(`const label = "System"; // the SYSTEM tab`)
    ).toEqual([]);
    expect(
      unthreadedSessionTools(
        "tools.role_create = new RoleCreateTool().build(permissionContext);"
      )
    ).toEqual(["RoleCreateTool"]);
    expect(
      unthreadedSessionTools(
        "tools.role_create = new RoleCreateTool().build(permissionContext, portalId ?? null);"
      )
    ).toEqual([]);
    expect(
      unthreadedSessionTools("tools.x = new RoleListTool().build(ctx);")
    ).toEqual([]);
  });
});
