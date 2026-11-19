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
 * mutation on prod while `org delete` stays refused there.
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
import { OrganizationUpdateRequestSchema } from "@portalai/core/contracts";

import { AdminInvalidInputError } from "../errors.js";
import { audit, beginMutation, withStore, type MutateFlags } from "./common.js";
import { lastJsonLine } from "./provision.js";

export const DEMO_DEFAULT_TIER = "enterprise";
export const DEMO_DEFAULT_ROWS = 10_000;
/** The `--rows` ceiling. apps/api's `src/db/demo-create.ts` holds the same
 *  value (this package can't import apps/api); keep the two equal. */
export const DEMO_MAX_ROWS = 10_000_000;

export interface DemoCreateOptions {
  name: string;
  ownerEmail: string;
  tier?: string;
  /** The raw flag value; validated here. */
  rows?: string | number;
}

/** The app's rule for an org name (trimmed, 1–120, one line), as `org update`. */
function validName(raw: string): string {
  const parsed = OrganizationUpdateRequestSchema.safeParse({ name: raw });
  if (!parsed.success || parsed.data.name === undefined) {
    throw new AdminInvalidInputError(
      parsed.success
        ? "--name is required"
        : (parsed.error.issues[0]?.message ?? "Invalid --name")
    );
  }
  return parsed.data.name;
}

function validRows(raw: string | number | undefined): number {
  if (raw === undefined) return DEMO_DEFAULT_ROWS;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text) || Number(text) > DEMO_MAX_ROWS) {
    throw new AdminInvalidInputError(
      `--rows must be a whole number from 0 to ${DEMO_MAX_ROWS}`
    );
  }
  return Number(text);
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
  const name = validName(opts.name);
  const rows = validRows(opts.rows);
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
  flags: MutateFlags
): Promise<{ id: string; deleted: true }> {
  // A mutation, not destructive: the marker confines it to demo orgs.
  const operator = await beginMutation(def, flags, false);
  await withStore(def, (s) => s.softDeleteDemoOrg(id, operator));
  await audit(def, operator, "demo delete", { orgId: id });
  return { id, deleted: true };
}
