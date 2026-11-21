/**
 * Demo-org commands (#1035): `portalai demo create` / `demo delete`.
 *
 * A demo is an ephemeral org per client. `demo create` provisions a brand-new
 * org through the app's own path and loads the demo dataset onto a station of
 * its own, so nothing has to be found in an org people have since edited (the
 * #509 `demo seed --org` / `demo reset` pair, which this replaces, attached the
 * dataset to whichever station a lookup returned first).
 *
 * Spawn-backed like `provision.ts`: the app's `db:demo:create` script owns
 * provisioning, the marker, the dataset and the cleanup of a failed load; the
 * CLI owns input checks, env resolution, guards, session and audit. No
 * cross-package runtime import.
 *
 * Guard semantics: both commands are **mutations** — `--yes` on app-dev,
 * `--yes --confirm-prod` on prod. `demo delete` only removes an org
 * `demo create` marked (`organizations.is_demo`), which is why it can be a
 * mutation on prod while `org delete` stays refused there. It runs the app's
 * full organization deletion (#197) through `db:demo:delete`, in the env's
 * API task on an AWS env (#1088, see org-deletion.ts): the org's
 * content is hard-deleted and the org and its memberships tombstoned, so a
 * finished demo leaves no data behind (code review, #1035).
 *
 * Toolpack config: on AWS envs the CLI reads `DEMO_TOOLPACK_URL` (SSM) and
 * `DEMO_TOOLPACK_SIGNING_SECRETS` (Secrets Manager) itself and hands them to
 * the script; either one missing is "not configured" (exit 3) before anything
 * runs. A fresh org has no stored secret to fall back on, and the demo Lambda
 * verifies against its allow-list, so both are needed. Local envs keep
 * reading them from the shell or apps/api's `.env`.
 */

import {
  EnvNotConfiguredError,
  getParam,
  getSecret,
  isAwsNotFound,
  npmSpawner,
  runApiScript,
  type WorkspaceSpawner,
} from "@portalai/cli-env";
import type { EnvironmentDefinition } from "@portalai/cli-env";
import { DemoOrganizationCreateInputSchema } from "@portalai/core/contracts";

import { AdminConflictError, AdminInvalidInputError } from "../errors.js";
import { audit, beginMutation, withStore, type MutateFlags } from "./common.js";
import { runOrgDeletion } from "./org-deletion.js";
import { lastJsonLine } from "./provision.js";

export const DEMO_DEFAULT_TIER = "enterprise";
export const DEMO_DEFAULT_ROWS = 10_000;

export interface DemoCreateOptions {
  name: string;
  ownerEmail: string;
  tier?: string;
  /** The raw flag value; validated here. */
  rows?: string | number;
}

/** The name and `--rows` rules, shared with the `db:demo:create` script
 *  through core so the two can't drift (code review, #1035). */
function validInput(opts: DemoCreateOptions): { name: string; rows: number } {
  const parsed = DemoOrganizationCreateInputSchema.safeParse({
    name: opts.name,
    rows: String(opts.rows ?? DEMO_DEFAULT_ROWS).trim(),
  });
  if (!parsed.success) {
    throw new AdminInvalidInputError(
      parsed.error.issues[0]?.message ?? "Invalid demo create input"
    );
  }
  return parsed.data;
}

/** Read one catalog value; a missing one is "not configured for this env". */
async function readConfig(
  def: EnvironmentDefinition,
  read: () => Promise<string>,
  envVar: string,
  where: string
): Promise<string> {
  try {
    return await read();
  } catch (err) {
    if (isAwsNotFound(err)) {
      throw new EnvNotConfiguredError(
        `${envVar} is not set for ${def.name} (${where}) — set it with \`portalops vars set ${envVar} <value> --env ${def.name}\` before creating a demo`
      );
    }
    throw err;
  }
}

/** The demo toolpack's config for AWS envs; local supplies its own. */
async function demoToolpackEnv(
  def: EnvironmentDefinition
): Promise<Record<string, string>> {
  if (!def.aws) return {};
  return {
    DEMO_TOOLPACK_URL: await readConfig(
      def,
      () => getParam(def, "demo-toolpack-url"),
      "DEMO_TOOLPACK_URL",
      "SSM demo-toolpack-url"
    ),
    DEMO_TOOLPACK_SIGNING_SECRETS: await readConfig(
      def,
      () => getSecret(def, "demo-toolpack-signing-secrets"),
      "DEMO_TOOLPACK_SIGNING_SECRETS",
      "Secrets Manager demo-toolpack-signing-secrets"
    ),
  };
}

export async function demoCreate(
  def: EnvironmentDefinition,
  opts: DemoCreateOptions,
  flags: MutateFlags,
  spawner: WorkspaceSpawner = npmSpawner
): Promise<Record<string, unknown>> {
  const { name, rows } = validInput(opts);
  const tier = opts.tier ?? DEMO_DEFAULT_TIER;

  const operator = await beginMutation(def, flags, false);
  // Refuse before anything is created: the script would fail the same way,
  // but only as an infra-shaped exit 7.
  await withStore(def, async (store) => {
    await store.getUserByEmail(opts.ownerEmail);
    await store.getTier(tier);
  });
  const extraEnv = await demoToolpackEnv(def);

  const stdout = await runApiScript(
    def,
    "db:demo:create",
    [
      "--name",
      name,
      "--owner-email",
      opts.ownerEmail,
      "--tier",
      tier,
      "--rows",
      String(rows),
    ],
    spawner,
    extraEnv
  );
  const result = lastJsonLine(stdout);
  const organizationId = String(result.organizationId);
  await audit(def, operator, "demo create", {
    organizationId,
    name,
    tier,
    rows,
  });

  // On stderr even under --json, which owns stdout.
  process.stderr.write(
    `Seeded ${rows} transactions; pass --rows <n> for a larger dataset. When the demo is over: portalai demo delete ${organizationId} --env ${def.name} --yes${def.kind === "production" ? " --confirm-prod" : ""}\n`
  );
  return result;
}

export async function demoDelete(
  def: EnvironmentDefinition,
  id: string,
  flags: MutateFlags,
  spawner: WorkspaceSpawner = npmSpawner
): Promise<Record<string, unknown>> {
  // A mutation, not destructive: the marker confines it to demo orgs.
  const operator = await beginMutation(def, flags, false);
  // Checked here so a refusal keeps its exit code (8 / 9); the script
  // re-checks, since it can be run directly.
  const isDemo = await withStore(def, (s) => s.isDemoOrg(id));
  if (!isDemo) {
    throw new AdminConflictError(
      `Organization ${id} is not a demo org — demo delete only removes orgs made by demo create`
    );
  }
  const result = await runOrgDeletion(
    def,
    "demo-delete",
    id,
    operator,
    spawner
  );
  await audit(def, operator, "demo delete", { orgId: id });
  return result;
}
