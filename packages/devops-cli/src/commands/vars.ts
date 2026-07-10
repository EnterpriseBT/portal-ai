/**
 * `portalops vars …` — the managed-config commands over the catalog (#192).
 * Read commands live here in slice 1; writes (set/apply/template) arrive in
 * slice 2. Library-first: these are plain async functions returning data —
 * bin.ts owns flags, guards, and printing.
 */

import fs from "node:fs";
import path from "node:path";

import {
  assertOperationAllowed,
  getParam,
  getSecret,
  putParam,
  putSecret,
  recordAudit,
  EnvInfraError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { CATALOG, lookupKey, mask, pathFor, type CatalogKind } from "../catalog.js";

/** Confirmation flags every mutating command threads to the guard. Guards
 *  live IN the command functions (not just the bin) so library consumers —
 *  test harnesses, agents importing directly — get the same protection. */
export interface MutateOptions {
  yes?: boolean;
  confirmProd?: boolean;
  /** Injectable stdin reader (for `set KEY -`). */
  stdin?: () => Promise<string>;
}

const guardMutation = (def: EnvironmentDefinition, opts: MutateOptions): void =>
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

/** Write one catalog value. Never logs the value (audit carries key/kind only). */
async function writeEntry(
  def: EnvironmentDefinition,
  entry: (typeof CATALOG)[number],
  value: string
): Promise<{ created: boolean }> {
  if (entry.kind === "secret") {
    return putSecret(def, entry.name, value);
  }
  await putParam(def, entry.name, value, entry.ssmType ?? "String");
  return { created: false };
}

// ── describe ─────────────────────────────────────────────────────────

export interface DescribeEntry {
  key: string;
  kind: CatalogKind;
  path: string;
  ssmType?: "String" | "SecureString";
}
export interface DescribeResult {
  env: string;
  region: string | null;
  entries: DescribeEntry[];
}

/** The catalog with resolved paths — fetches NO values. */
export async function describeVars(
  def: EnvironmentDefinition
): Promise<DescribeResult> {
  return {
    env: def.name,
    region: def.aws?.region ?? null,
    entries: CATALOG.map((e) => ({
      key: e.key,
      kind: e.kind,
      path: pathFor(def, e),
      ...(e.ssmType ? { ssmType: e.ssmType } : {}),
    })),
  };
}

// ── list ─────────────────────────────────────────────────────────────

export interface ListEntry {
  key: string;
  kind: CatalogKind;
  /** The display value: raw (ssm / --unmask), masked (secret), or "(unset)". */
  value: string;
  masked: boolean;
}

async function fetchValue(
  def: EnvironmentDefinition,
  entry: (typeof CATALOG)[number]
): Promise<string | null> {
  try {
    return entry.kind === "secret"
      ? await getSecret(def, entry.name)
      : await getParam(def, entry.name);
  } catch (err) {
    // A missing key is "(unset)" (bash `|| true`); an authorization or
    // configuration failure must PROPAGATE — silently reporting every key
    // as unset when credentials lapsed would be a lie.
    if (err instanceof EnvInfraError) return null;
    throw err;
  }
}

/** Every catalog entry with its live value — secrets masked unless `unmask`. */
export async function listVars(
  def: EnvironmentDefinition,
  opts: { unmask?: boolean }
): Promise<{ entries: ListEntry[] }> {
  const entries = await Promise.all(
    CATALOG.map(async (e): Promise<ListEntry> => {
      const value = await fetchValue(def, e);
      if (value === null) {
        return { key: e.key, kind: e.kind, value: "(unset)", masked: false };
      }
      if (e.kind === "secret" && !opts.unmask) {
        return { key: e.key, kind: e.kind, value: mask(value), masked: true };
      }
      return { key: e.key, kind: e.kind, value, masked: false };
    })
  );
  return { entries };
}

// ── get ──────────────────────────────────────────────────────────────

/** One raw value — an explicit single read is never masked (bash parity). */
export async function getVar(
  def: EnvironmentDefinition,
  key: string
): Promise<{ key: string; value: string }> {
  const entry = lookupKey(key);
  const value =
    entry.kind === "secret"
      ? await getSecret(def, entry.name)
      : await getParam(def, entry.name);
  return { key, value };
}

// ── set ──────────────────────────────────────────────────────────────

export interface SetResult {
  key: string;
  updated: true;
  /** true ⇒ a NEW secret was created — its ARN must be added to the deploy
   *  workflow / CloudFormation before the next deploy (bin warns). */
  created: boolean;
}

/** Write one value (`"-"` reads stdin). Refuses empty; guarded + audited. */
export async function setVar(
  def: EnvironmentDefinition,
  key: string,
  rawValue: string,
  opts: MutateOptions = {}
): Promise<SetResult> {
  const entry = lookupKey(key);
  const value = (
    rawValue === "-" ? await (opts.stdin ?? readStdin)() : rawValue
  ).trim();
  if (!value) {
    throw new Error(`Refusing to set empty value for ${key}`);
  }
  guardMutation(def, opts);
  const { created } = await writeEntry(def, entry, value);
  await recordAudit({
    env: def.name,
    operator: "portalops",
    command: "vars set",
    args: { key, kind: entry.kind, created },
  });
  return { key, updated: true, created };
}

// ── apply ────────────────────────────────────────────────────────────

/** Parse a KEY=VALUE env file: skip blanks/comments, strip one matching pair
 *  of surrounding quotes, validate EVERY line before any write (bash parity,
 *  api-cli.sh:510-551). */
function parseEnvFile(
  file: string,
  content: string
): Array<{ key: string; value: string }> {
  const pending: Array<{ key: string; value: string }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineno = i + 1;
    const line = lines[i].replace(/^\s+/, "");
    if (!line || line.startsWith("#")) continue;
    if (!line.includes("=")) {
      throw new Error(`${file}:${lineno}: missing '=' in line: ${line}`);
    }
    const key = line.slice(0, line.indexOf("=")).replace(/\s+$/, "");
    let value = line.slice(line.indexOf("=") + 1);
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    try {
      lookupKey(key);
    } catch {
      throw new Error(`${file}:${lineno}: unknown key '${key}' (run 'portalops vars describe')`);
    }
    if (!value) {
      throw new Error(`${file}:${lineno}: empty value for '${key}'`);
    }
    pending.push({ key, value });
  }
  return pending;
}

/** Batch-apply an env file. Validates wholesale before ANY write; guard once;
 *  audit per key. */
export async function applyVars(
  def: EnvironmentDefinition,
  file: string,
  opts: MutateOptions = {}
): Promise<{ applied: string[] }> {
  const pending = parseEnvFile(file, fs.readFileSync(file, "utf8"));
  if (pending.length === 0) return { applied: [] };

  guardMutation(def, opts);
  for (const { key, value } of pending) {
    const entry = lookupKey(key);
    const { created } = await writeEntry(def, entry, value);
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "vars apply",
      args: { key, kind: entry.kind, created, file: path.basename(file) },
    });
  }
  return { applied: pending.map((p) => p.key) };
}

// ── template ─────────────────────────────────────────────────────────

/** Generate a pre-filled env file (0600). Refuses overwrite. The FILE HOLDS
 *  PLAINTEXT SECRETS — the caller must surface `warning`. */
export async function templateVars(
  def: EnvironmentDefinition,
  outPath?: string
): Promise<{ path: string; warning: string }> {
  const out = outPath ?? `./cloud-vars.${def.name}.env`;
  if (fs.existsSync(out)) {
    throw new Error(`${out} already exists; refusing to overwrite`);
  }

  const lines: string[] = [
    `# cloud-vars template for env=${def.name}`,
    `# Apply with: portalops vars apply ${out} --env ${def.name} --yes`,
    "",
    "# ── Secrets Manager (sensitive) ─",
  ];
  for (const e of CATALOG.filter((e) => e.kind === "secret")) {
    const v = await fetchValue(def, e);
    lines.push(`${e.key}=${v ?? ""}`);
  }
  lines.push("", "# ── SSM Parameter Store (config) ─");
  for (const e of CATALOG.filter((e) => e.kind === "ssm")) {
    const v = await fetchValue(def, e);
    lines.push(`${e.key}=${v ?? ""}`);
  }

  fs.writeFileSync(out, `${lines.join("\n")}\n`, { mode: 0o600 });
  return {
    path: out,
    warning: `${out} contains plaintext secrets. Do not commit it.`,
  };
}
