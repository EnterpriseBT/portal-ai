/**
 * `portalops vars …` — the managed-config commands over the catalog (#192).
 * Read commands live here in slice 1; writes (set/apply/template) arrive in
 * slice 2. Library-first: these are plain async functions returning data —
 * bin.ts owns flags, guards, and printing.
 */

import {
  getParam,
  getSecret,
  EnvInfraError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { CATALOG, lookupKey, mask, pathFor, type CatalogKind } from "../catalog.js";

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
