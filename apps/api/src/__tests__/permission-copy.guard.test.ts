/**
 * #711: a refusal, hint or doc names the **permission**, never a role.
 * Policies govern permissions; roles and groups only package policies, and a
 * custom policy, a group or a direct grant can hand anyone any permission.
 * "Your role does not permit this action" or "only the owner can …" is wrong
 * for exactly the people custom RBAC exists for.
 *
 * Scans every API source file as UTF-8 text, comments included: route JSDoc
 * becomes the published OpenAPI docs. Never via `grep`: `permission-set.ts`
 * carries NUL-byte sentinels, so grep treats it as binary and skips it.
 *
 * The one allowlisted rule is *about* roles: only the owner may assign or
 * remove the owner/admin roles (an accepted heuristic, not a policy
 * permission), so its code and message name them.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Role-framed refusal phrasing. */
export const ROLE_FRAMED: RegExp[] = [
  /\byour role (does not|doesn'?t|may not|can'?t|lacks)\b/i,
  /\bonly the (organization'?s? )?owner\b/i,
  /\bowner or admin\b/i,
  /\b(is|are) not (an |the )?(organization'?s? )?owner\b/i,
  /\bask (an|your|their) admin\b/i,
  /\badmin-(only|curated)\b/i,
  /\b(INSUFFICIENT_ROLE|BILLING_NOT_OWNER|ORGANIZATION_NOT_OWNER|AUDIT_LOG_NOT_AUTHORIZED)\b/,
];

/** Exact, justified exceptions: rules about roles. Shrink-only. */
const ALLOWED: Array<{ file: string; text: string }> = [
  {
    file: "services/seat.service.ts",
    text: "Only the owner can assign or remove the owner or admin role",
  },
  {
    file: "constants/api-codes.constants.ts",
    text: "only the owner may assign or remove the owner/admin roles",
  },
];

/** Every line of `source` matching a role-framed phrase. */
export function roleFramedLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => ROLE_FRAMED.some((re) => re.test(line)))
    .map((line) => line.trim());
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

describe("API copy names permissions, not roles (#711)", () => {
  const files = sourceFiles(apiSrc).map((path) => ({
    path: relative(apiSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("scans the API source, including the NUL-byte permission-set.ts", () => {
    expect(files.length).toBeGreaterThanOrEqual(200);
    const set = files.find((f) => f.path === "services/permission-set.ts");
    expect(set?.source).toContain("permissionDenied(action, object)");
  });

  it("no role-framed refusal phrasing outside the allowlist", () => {
    const offenders = files.flatMap((f) =>
      roleFramedLines(f.source)
        .filter(
          (line) =>
            !ALLOWED.some((a) => a.file === f.path && line.includes(a.text))
        )
        .map((line) => `${f.path}: ${line}`)
    );
    expect(offenders).toEqual([]);
  });

  it("every allowlisted rule still exists (the list only shrinks)", () => {
    for (const a of ALLOWED) {
      expect(files.find((f) => f.path === a.file)?.source).toContain(a.text);
    }
  });

  it("catches each phrase, and lets ordinary role talk through", () => {
    for (const bad of [
      "Your role does not permit this action",
      "Only the organization owner can manage billing",
      "Ask an owner or admin for access",
      "The caller is not the organization's owner",
      "ask their admin to add it",
      "Column definitions are admin-only",
      "ApiCode.INSUFFICIENT_ROLE",
    ]) {
      expect([bad, roleFramedLines(bad)]).toEqual([bad, [bad]]);
    }
    for (const ok of [
      "## Your role: route to a tool",
      "Your roles",
      "keyed by user (not the owner alone)",
      "You don't have permission to manage billing.",
    ]) {
      expect([ok, roleFramedLines(ok)]).toEqual([ok, []]);
    }
  });
});
