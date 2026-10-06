/**
 * #711: what the app tells a user about access names the **permission**,
 * never a role. Policies govern permissions; roles and groups only package
 * policies, so "ask an owner or admin" or "only the owner can …" is wrong for
 * anyone whose access comes from a custom policy, a group or a grant.
 *
 * Scans the web source and the core help content (FAQ and glossary, which
 * the marketing site also renders) as UTF-8 text. Role-management UI that is
 * *about* roles ("Your roles", the role menu) doesn't use these phrases, so
 * the allowlist is empty.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const webSrc = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreContent = join(webSrc, "../../../packages/core/src/content");

/** Role-framed refusal phrasing (the same list as the API guard). */
const ROLE_FRAMED: RegExp[] = [
  /\byour role (does not|doesn'?t|may not|can'?t|lacks)\b/i,
  /\bonly the (organization'?s? )?owner\b/i,
  /\bowner or admin\b/i,
  /\b(is|are) not (an |the )?(organization'?s? )?owner\b/i,
  /\bask (an|your|their) admin\b/i,
  /\badmin-(only|curated)\b/i,
  /\b(INSUFFICIENT_ROLE|BILLING_NOT_OWNER|ORGANIZATION_NOT_OWNER|AUDIT_LOG_NOT_AUTHORIZED)\b/,
];

function roleFramedLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => ROLE_FRAMED.some((re) => re.test(line)))
    .map((line) => line.trim());
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "stories"
        ? []
        : sourceFiles(path);
    }
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("web copy and help name permissions, not roles (#711)", () => {
  const files = [
    ...sourceFiles(webSrc).map((path) => ({
      path: relative(webSrc, path),
      source: readFileSync(path, "utf8"),
    })),
    ...sourceFiles(coreContent).map((path) => ({
      path: `core/content/${relative(coreContent, path)}`,
      source: readFileSync(path, "utf8"),
    })),
  ];

  it("scans the web source and the core help content", () => {
    expect(files.length).toBeGreaterThanOrEqual(200);
    expect(files.some((f) => f.path === "core/content/faq.util.ts")).toBe(true);
    expect(files.some((f) => f.path === "core/content/glossary.util.ts")).toBe(
      true
    );
  });

  it("no role-framed refusal phrasing", () => {
    const offenders = files.flatMap((f) =>
      roleFramedLines(f.source).map((line) => `${f.path}: ${line}`)
    );
    expect(offenders).toEqual([]);
  });

  it("catches each phrase, and lets role-management copy through", () => {
    expect(
      roleFramedLines("Ask an owner or admin for access to create views")
    ).toHaveLength(1);
    expect(
      roleFramedLines("Only the organization owner can manage billing")
    ).toHaveLength(1);
    expect(roleFramedLines("Ask an admin to resend it")).toHaveLength(1);
    expect(roleFramedLines("Your roles")).toEqual([]);
    expect(roleFramedLines("Can't remove the last owner")).toEqual([]);
    expect(roleFramedLines("Ask for access to create views")).toEqual([]);
  });
});
