/**
 * The operator's repo checkout of a stack's CloudFormation template (#861).
 *
 * `cache phase`/`switch` update a stack on its DEPLOYED template, changing
 * parameters only. The deploy workflows apply templates with `aws
 * cloudformation deploy`, which skips a change set with no resource changes,
 * so a template that only adds parameters, conditions and outputs never
 * lands. `cache refresh-template` applies it explicitly, from a clean
 * checkout of `origin/main`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type StackKind = "cache" | "backend";

/** `infra/cloudformation/<kind>.yml` from the repo this CLI runs in, found
 *  by walking up from the CLI itself; `null` outside a checkout. */
export function readRepoTemplate(
  kind: StackKind
): { path: string; body: string } | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "infra", "cloudformation", `${kind}.yml`);
    if (existsSync(candidate)) {
      return { path: candidate, body: readFileSync(candidate, "utf8") };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Where the checkout stands relative to `origin/main`, read with git in the
 *  repo holding `templatePath`. `dirty` means that template has uncommitted
 *  changes. */
export function repoGitState(templatePath: string): {
  head: string;
  main: string;
  dirty: boolean;
} {
  const cwd = path.dirname(templatePath);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  let main = "";
  try {
    main = git("rev-parse", "origin/main");
  } catch {
    main = "";
  }
  return {
    head: git("rev-parse", "HEAD"),
    main,
    dirty: git("status", "--porcelain", "--", templatePath) !== "",
  };
}
