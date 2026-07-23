/**
 * `portalops tier apply` (#218) — converge declared tier rows to the
 * in-repo catalog (`@portalai/core/registries` → `TIER_CATALOG`).
 *
 * Policy lives in git; pricing lives in Stripe; apply is the join:
 * the Stripe phase is READ-ONLY lookup-key resolution (fail-closed on a
 * missing price), the DB phase is one transaction of upserts-by-slug for
 * declared slugs only. Rows the catalog doesn't name are never read
 * further, never written, never deleted — they surface once as
 * `unmanaged`. Validate-all-then-write, per the `vars apply` shape.
 */

import { randomUUID } from "node:crypto";

import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  assertOperationAllowed,
  recordAudit,
  resolveEnvConnection,
  type EnvironmentDefinition,
} from "@portalai/cli-env";
import {
  TIER_CATALOG,
  BuiltinToolpackSlugSchema,
  type TierCatalogEntry,
} from "@portalai/core/registries";

import {
  resolveStripeKey,
  stripePriceResolver,
  TierApplyMissingPricesError,
  type PriceResolver,
  type SecretReader,
} from "../stripe.js";
import { tiers } from "../tables.js";
import type { MutateOptions } from "./vars.js";

/** `tier create` targeted a slug that already exists (#241). Maps to exit 9. */
export class TierAlreadyExistsError extends Error {
  readonly code = "TIER_ALREADY_EXISTS";
  constructor(readonly slug: string) {
    super(`A tier with slug "${slug}" already exists`);
    this.name = "TierAlreadyExistsError";
  }
}

/** `tier update`/`tier description` targeted a missing slug (#241). Exit 8. */
export class TierNotFoundError extends Error {
  readonly code = "TIER_NOT_FOUND";
  constructor(readonly slug: string) {
    super(`No tier with slug "${slug}"`);
    this.name = "TierNotFoundError";
  }
}

/** Catalog-owned policy fields, converged verbatim (order = render order).
 *  `stripePriceId` joins them after lookup-key resolution. */
export const CONVERGED_POLICY_FIELDS = [
  "displayName",
  "periodKind",
  "periodAnchorDay",
  "overage",
  "freeUnitsPerPeriod",
  "freeRatePerMin",
  "meteredUnitsPerPeriod",
  "meteredRatePerMin",
  "expensiveUnitsPerPeriod",
  "expensiveRatePerMin",
  "perToolCaps",
  "selectable",
  "builtinToolpacks",
  "customToolpacks",
  // #241: the card CTA is catalog-owned policy. `description` and
  // `visibleToOrganizationId` are NOT here — they are operator/per-client
  // state a `tier apply` must never clobber.
  "cta",
] as const;
type ConvergedPolicyField = (typeof CONVERGED_POLICY_FIELDS)[number];

export interface TierFieldChange {
  from: unknown;
  to: unknown;
}

export interface TierChange {
  slug: string;
  action: "insert" | "update" | "noop";
  /** Changed fields only (every field for an insert, `from: null`). */
  fields: Record<string, TierFieldChange>;
  /** The resolved env-local price id (null = not purchasable). */
  stripePriceId: string | null;
}

export interface TierApplyResult {
  dryRun: boolean;
  changes: TierChange[];
  /** Live tier slugs the catalog doesn't name — untouched by design. */
  unmanaged: string[];
}

/** The live-row shape apply reads (subset of the `tiers` row). */
export type TierRow = { slug: string; stripePriceId: string | null } & {
  [K in ConvergedPolicyField]: unknown;
};

/** DB seam — injectable for tests; the real store is drizzle-backed. */
export interface TierStore {
  readAll(): Promise<TierRow[]>;
  applyChanges(changes: TierChange[]): Promise<void>;
  /** Insert one custom tier row (#241 `tier create`). */
  createTier(values: Record<string, unknown>): Promise<void>;
  /** Update one tier by slug (#241 `tier update`). */
  updateTier(slug: string, sets: Record<string, unknown>): Promise<void>;
  /** Set/clear a tier's blurb by slug (#241 `tier description`). */
  setDescription(slug: string, value: string | null): Promise<void>;
  close(): Promise<void>;
}

/** jsonb-safe comparison (arrays/objects compared structurally). */
const eqJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Pure diff: catalog + live rows + resolved prices → changes. */
export function computeTierChanges(
  catalog: readonly TierCatalogEntry[],
  rows: TierRow[],
  prices: Map<string, string>
): { changes: TierChange[]; unmanaged: string[] } {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const declared = new Set(catalog.map((e) => e.slug));

  const changes: TierChange[] = catalog.map((entry) => {
    const target: Record<string, unknown> = {};
    for (const field of CONVERGED_POLICY_FIELDS) target[field] = entry[field];
    const stripePriceId = entry.stripeLookupKey
      ? (prices.get(entry.stripeLookupKey) ?? null)
      : null;
    target.stripePriceId = stripePriceId;

    const live = bySlug.get(entry.slug);
    if (!live) {
      return {
        slug: entry.slug,
        action: "insert" as const,
        fields: Object.fromEntries(
          Object.entries(target).map(([k, to]) => [k, { from: null, to }])
        ),
        stripePriceId,
      };
    }

    const fields: Record<string, TierFieldChange> = {};
    for (const [key, to] of Object.entries(target)) {
      const from = (live as Record<string, unknown>)[key];
      if (!eqJson(from, to)) fields[key] = { from, to };
    }
    return {
      slug: entry.slug,
      action:
        Object.keys(fields).length > 0
          ? ("update" as const)
          : ("noop" as const),
      fields,
      stripePriceId,
    };
  });

  const unmanaged = rows
    .filter((r) => !declared.has(r.slug))
    .map((r) => r.slug);

  return { changes, unmanaged };
}

/** Row values for an insert change — stamped `portalops`. */
export function insertValuesFor(change: TierChange): Record<string, unknown> {
  const values: Record<string, unknown> = {
    id: randomUUID(),
    created: Date.now(),
    createdBy: "portalops",
    slug: change.slug,
  };
  for (const [key, { to }] of Object.entries(change.fields)) values[key] = to;
  return values;
}

/** SET map for an update change — changed fields + audit stamps only. */
export function updateSetsFor(change: TierChange): Record<string, unknown> {
  const sets: Record<string, unknown> = {
    updated: Date.now(),
    updatedBy: "portalops",
  };
  for (const [key, { to }] of Object.entries(change.fields)) sets[key] = to;
  return sets;
}

/** The drizzle-backed store — one transaction for the whole apply. */
export function createTierStore(connectionString: string): TierStore {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  return {
    async readAll() {
      const rows = await db.select().from(tiers).where(isNull(tiers.deleted));
      return rows as unknown as TierRow[];
    },
    async applyChanges(changes) {
      await db.transaction(async (tx) => {
        for (const change of changes) {
          if (change.action === "insert") {
            await tx.insert(tiers).values(insertValuesFor(change) as never);
          } else if (change.action === "update") {
            await tx
              .update(tiers)
              .set(updateSetsFor(change) as never)
              .where(eq(tiers.slug, change.slug));
          }
        }
      });
    },
    async createTier(values) {
      await db.insert(tiers).values(values as never);
    },
    async updateTier(slug, sets) {
      await db
        .update(tiers)
        .set(sets as never)
        .where(eq(tiers.slug, slug));
    },
    async setDescription(slug, value) {
      await db
        .update(tiers)
        .set({
          description: value,
          updated: Date.now(),
          updatedBy: "portalops",
        } as never)
        .where(eq(tiers.slug, slug));
    },
    async close() {
      await client.end();
    },
  };
}

/**
 * Default store: open the env connection, its DB path (local: `.env`; AWS:
 * SSM tunnel), and a drizzle-backed store over the resulting connection
 * string. The returned `close()` tears down BOTH the postgres client AND the
 * connection/tunnel — client first, connection in a `finally` so a client
 * error still frees the tunnel. Without the `dispose()`, the AWS tunnel's
 * child process keeps the event loop alive and the CLI never exits (#242);
 * mirrors `db psql`'s dispose-in-finally. Idempotent and a no-op on local.
 * `resolve` is injectable so the teardown is unit-testable without a tunnel.
 */
export async function openEnvTierStore(
  envName: string,
  resolve: typeof resolveEnvConnection = resolveEnvConnection
): Promise<TierStore> {
  const connection = await resolve(envName);
  const handle = await connection.db();
  const store = createTierStore(handle.connectionString);
  return {
    readAll: () => store.readAll(),
    applyChanges: (changes) => store.applyChanges(changes),
    createTier: (values) => store.createTier(values),
    updateTier: (slug, sets) => store.updateTier(slug, sets),
    setDescription: (slug, value) => store.setDescription(slug, value),
    async close() {
      try {
        await store.close();
      } finally {
        await connection.dispose();
      }
    },
  };
}

const guard = (def: EnvironmentDefinition, opts: MutateOptions): void =>
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

export interface TierApplyDeps {
  /** Override the catalog (tests / future --catalog flag). */
  catalog?: readonly TierCatalogEntry[];
  resolvePrices?: PriceResolver;
  readSecret?: SecretReader;
  store?: () => Promise<TierStore>;
}

/**
 * The apply. Ordering: resolve Stripe (read-only, fail-closed) → read
 * rows → diff → dry-run returns here → guard once → one tx → audit per
 * changed slug.
 */
export async function tierApply(
  def: EnvironmentDefinition,
  opts: MutateOptions & { dryRun?: boolean } = {},
  deps: TierApplyDeps = {}
): Promise<TierApplyResult> {
  const catalog = deps.catalog ?? TIER_CATALOG;

  // Stripe phase — skipped entirely when nothing is purchasable, so a
  // catalog with no lookup keys needs no Stripe key at all.
  const lookupKeys = catalog
    .map((e) => e.stripeLookupKey)
    .filter((k): k is string => k !== null);
  let prices = new Map<string, string>();
  if (lookupKeys.length > 0) {
    const stripeKey = await resolveStripeKey(def, deps.readSecret);
    prices = await (deps.resolvePrices ?? stripePriceResolver)(
      stripeKey,
      lookupKeys
    );
    const missing = lookupKeys.filter((k) => !prices.has(k));
    if (missing.length > 0) throw new TierApplyMissingPricesError(missing);
  }

  // DB phase.
  const openStore = deps.store ?? (() => openEnvTierStore(def.name));
  const store = await openStore();
  try {
    const rows = await store.readAll();
    const { changes, unmanaged } = computeTierChanges(catalog, rows, prices);

    if (opts.dryRun) return { dryRun: true, changes, unmanaged };

    const dirty = changes.filter((c) => c.action !== "noop");
    if (dirty.length > 0) {
      guard(def, opts);
      await store.applyChanges(dirty);
      for (const change of dirty) {
        await recordAudit({
          env: def.name,
          operator: "portalops",
          command: "tier apply",
          args: {
            slug: change.slug,
            action: change.action,
            fields: Object.keys(change.fields),
            stripePriceId: change.stripePriceId,
          },
        });
      }
    }
    return { dryRun: false, changes, unmanaged };
  } finally {
    await store.close();
  }
}

// ── tier create / update / description (#241) ─────────────────────────

/** The operator-supplied fields for a custom tier. `slug` identifies the row;
 *  everything else is optional (create fills defaults; update changes only the
 *  keys present). Allocations default to unlimited (null) — the enterprise
 *  "let's talk" posture — and are adjusted out-of-band if a bespoke cap is
 *  ever needed. */
export interface TierWriteInput {
  slug: string;
  displayName?: string;
  cta?: string;
  overage?: string;
  stripePriceId?: string | null;
  visibleToOrganizationId?: string | null;
  description?: string | null;
}

export interface TierWriteDeps {
  store?: () => Promise<TierStore>;
}

/** Full row values for `tier create`. Enterprise defaults: unlimited
 *  allocations, all built-in toolpacks + custom allowed, monthly period,
 *  `contact` CTA, listed (`selectable`). */
export function buildTierCreateValues(
  input: TierWriteInput
): Record<string, unknown> {
  return {
    id: randomUUID(),
    created: Date.now(),
    createdBy: "portalops",
    slug: input.slug,
    displayName: input.displayName,
    periodKind: "monthly",
    periodAnchorDay: 1,
    overage: input.overage ?? "hard-deny",
    freeUnitsPerPeriod: null,
    freeRatePerMin: null,
    meteredUnitsPerPeriod: null,
    meteredRatePerMin: null,
    expensiveUnitsPerPeriod: null,
    expensiveRatePerMin: null,
    perToolCaps: null,
    stripePriceId: input.stripePriceId ?? null,
    selectable: true,
    builtinToolpacks: [...BuiltinToolpackSlugSchema.options],
    customToolpacks: true,
    cta: input.cta ?? "contact",
    description: input.description ?? null,
    visibleToOrganizationId: input.visibleToOrganizationId ?? null,
  };
}

/** SET map for `tier update` — only the provided fields + audit stamps. */
export function buildTierUpdateSets(
  input: TierWriteInput
): Record<string, unknown> {
  const sets: Record<string, unknown> = {
    updated: Date.now(),
    updatedBy: "portalops",
  };
  const fields: Array<keyof TierWriteInput> = [
    "displayName",
    "cta",
    "overage",
    "stripePriceId",
    "visibleToOrganizationId",
    "description",
  ];
  for (const f of fields) if (input[f] !== undefined) sets[f] = input[f];
  return sets;
}

/** Open the store, guard, then run `fn` with the read rows; always closes. */
async function withTierStore<T>(
  def: EnvironmentDefinition,
  opts: MutateOptions,
  deps: TierWriteDeps,
  fn: (store: TierStore, rows: TierRow[]) => Promise<T>
): Promise<T> {
  const store = await (deps.store ?? (() => openEnvTierStore(def.name)))();
  try {
    guard(def, opts);
    const rows = await store.readAll();
    return await fn(store, rows);
  } finally {
    await store.close();
  }
}

/** Create a custom tier row (#241). Conflict (exit 9) if the slug exists. */
export async function tierCreate(
  def: EnvironmentDefinition,
  input: TierWriteInput,
  opts: MutateOptions = {},
  deps: TierWriteDeps = {}
): Promise<{ slug: string; action: "insert" }> {
  return withTierStore(def, opts, deps, async (store, rows) => {
    if (rows.some((r) => r.slug === input.slug)) {
      throw new TierAlreadyExistsError(input.slug);
    }
    const values = buildTierCreateValues(input);
    await store.createTier(values);
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "tier create",
      args: {
        slug: input.slug,
        cta: values.cta,
        visibleToOrganizationId: values.visibleToOrganizationId,
      },
    });
    return { slug: input.slug, action: "insert" };
  });
}

/** Update a tier's fields (#241). Not-found (exit 8) if the slug is absent. */
export async function tierUpdate(
  def: EnvironmentDefinition,
  input: TierWriteInput,
  opts: MutateOptions = {},
  deps: TierWriteDeps = {}
): Promise<{ slug: string; action: "update"; fields: string[] }> {
  return withTierStore(def, opts, deps, async (store, rows) => {
    if (!rows.some((r) => r.slug === input.slug)) {
      throw new TierNotFoundError(input.slug);
    }
    const sets = buildTierUpdateSets(input);
    await store.updateTier(input.slug, sets);
    const fields = Object.keys(sets).filter(
      (k) => k !== "updated" && k !== "updatedBy"
    );
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "tier update",
      args: { slug: input.slug, fields },
    });
    return { slug: input.slug, action: "update", fields };
  });
}

/** Set or clear a tier's blurb (#241). Not-found (exit 8) if slug is absent. */
export async function tierDescription(
  def: EnvironmentDefinition,
  slug: string,
  value: string | null,
  opts: MutateOptions = {},
  deps: TierWriteDeps = {}
): Promise<{ slug: string; description: string | null }> {
  return withTierStore(def, opts, deps, async (store, rows) => {
    if (!rows.some((r) => r.slug === slug)) {
      throw new TierNotFoundError(slug);
    }
    await store.setDescription(slug, value);
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "tier description",
      args: { slug, cleared: value === null },
    });
    return { slug, description: value };
  });
}
