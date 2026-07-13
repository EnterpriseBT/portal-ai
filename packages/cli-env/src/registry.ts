/**
 * The environment registry (#194, Decision 1 — hybrid).
 *
 * Checked-in, NON-SECRET facts per environment: API base URL, AWS region and
 * the AWS-side env name (which drives every AWS naming convention), and the
 * `kind` classification that destructive-op gating keys on. Secrets
 * (database-url, …) are never here — they resolve from AWS Secrets Manager /
 * SSM at runtime (src/aws.ts).
 *
 * Ad-hoc test targets merge in from `~/.portalai/environments.json`, with
 * `kind` FORCED to "development" and built-in names un-shadowable.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { EnvNotConfiguredError } from "./errors.js";

export const EnvKindSchema = z.enum(["development", "staging", "production"]);
export type EnvKind = z.infer<typeof EnvKindSchema>;

const AwsConfigSchema = z
  .object({
    region: z.string().min(1),
    /** The AWS-side env name — NOTE: app-dev's is "dev" (api-cli.sh:65,72-73). */
    envName: z.string().min(1),
  })
  .strict();

export const EnvironmentDefinitionSchema = z
  .object({
    name: z.string().min(1),
    kind: EnvKindSchema,
    apiBaseUrl: z.url(),
    /** null ⇒ no AWS (local): db comes from .env, no tunnel/secrets. */
    aws: AwsConfigSchema.nullable(),
  })
  .strict();
export type EnvironmentDefinition = z.infer<typeof EnvironmentDefinitionSchema>;

export const BUILTIN_ENVIRONMENTS: Record<string, EnvironmentDefinition> = {
  local: {
    name: "local",
    kind: "development",
    apiBaseUrl: "http://localhost:3001",
    aws: null,
  },
  "app-dev": {
    name: "app-dev",
    kind: "staging",
    apiBaseUrl: "https://api-dev.portalsai.io",
    aws: { region: "us-east-1", envName: "dev" },
  },
  // prod: added (kind "production", envName "prod") when #83 provisions it.
};

/** `~/.portalai` — PORTALAI_HOME overrides for tests/agents/CI. */
export function portalaiDir(): string {
  return process.env.PORTALAI_HOME ?? path.join(os.homedir(), ".portalai");
}

/** Override entries may not set `name` (the key is the name) and any `kind`
 *  they claim is ignored — ad-hoc targets are always development. */
const OverrideEntrySchema = z
  .object({
    kind: EnvKindSchema.optional(),
    apiBaseUrl: z.url(),
    aws: AwsConfigSchema.nullable().optional(),
  })
  .strict();

/**
 * Built-ins merged with `~/.portalai/environments.json` (if present).
 * Overrides are validated per entry, have `kind` forced to "development",
 * and may not shadow a built-in name.
 */
export function loadEnvironments(): Record<string, EnvironmentDefinition> {
  const envs: Record<string, EnvironmentDefinition> = {
    ...BUILTIN_ENVIRONMENTS,
  };

  const file = path.join(portalaiDir(), "environments.json");
  if (!fs.existsSync(file)) return envs;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new EnvNotConfiguredError(
      `Malformed environment override file ${file}: ${(err as Error).message}`,
      { cause: err }
    );
  }

  const parsed = z
    .record(z.string().min(1), OverrideEntrySchema)
    .safeParse(raw);
  if (!parsed.success) {
    throw new EnvNotConfiguredError(
      `Invalid environment override file ${file}: ${parsed.error.message}`,
      { cause: parsed.error }
    );
  }

  for (const [name, entry] of Object.entries(parsed.data)) {
    if (name in BUILTIN_ENVIRONMENTS) {
      throw new EnvNotConfiguredError(
        `Environment override "${name}" in ${file} may not shadow a built-in environment`
      );
    }
    envs[name] = {
      name,
      kind: "development", // forced — ad-hoc targets are never staging/prod
      apiBaseUrl: entry.apiBaseUrl,
      aws: entry.aws ?? null,
    };
  }

  return envs;
}

/** Lookup or throw ENV_NOT_CONFIGURED naming the known environments. */
export function getEnvironment(name: string): EnvironmentDefinition {
  const envs = loadEnvironments();
  const def = envs[name];
  if (!def) {
    throw new EnvNotConfiguredError(
      `Unknown environment "${name}". Known environments: ${Object.keys(envs)
        .sort()
        .join(", ")}`
    );
  }
  return def;
}

// ── AWS naming conventions (mirror api-cli.sh:68-74) ─────────────────

function requireAws(
  def: EnvironmentDefinition
): NonNullable<EnvironmentDefinition["aws"]> {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `Environment "${def.name}" has no AWS configuration (local-only)`
    );
  }
  return def.aws;
}

export function secretsPrefix(def: EnvironmentDefinition): string {
  return `portalai/${requireAws(def).envName}`;
}

export function ssmPrefix(def: EnvironmentDefinition): string {
  return `/portalai/${requireAws(def).envName}`;
}

export function clusterName(def: EnvironmentDefinition): string {
  return `portalai-${requireAws(def).envName}`;
}

export function bastionExportName(def: EnvironmentDefinition): string {
  return `${requireAws(def).envName}-BastionInstanceId`;
}
