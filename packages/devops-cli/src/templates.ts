/**
 * The operator's repo checkout of a stack's CloudFormation template (#861).
 *
 * `cache phase`/`switch` normally update a stack on its DEPLOYED template.
 * That fails when the deployed template predates a parameter: the deploy
 * workflows apply templates with `aws cloudformation deploy`, which never
 * applies a change set with no resource changes, so a template that only
 * adds parameters, conditions and outputs never lands. The CLI then applies
 * the template from the checkout it runs in, which the runbook requires to be
 * `main`.
 */

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
