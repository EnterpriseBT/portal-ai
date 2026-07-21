/**
 * `tier apply` (#218) — the Stripe seams (slice 2) and the apply command
 * (slice 3): diff computation, dry-run purity, fail-closed resolution,
 * converge-declared-only, guard + per-slug audit.
 */

import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvNotConfiguredError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

// Mock the drizzle/postgres layer so `createTierStore` (and thus
// `openEnvTierStore`) builds without a live database. Only the teardown
// tests exercise this path — every other case injects the store seam. The
// postgres client's `end()` is the spy the teardown tests assert against.
const pgEnd = jest.fn<() => Promise<void>>();
jest.unstable_mockModule("postgres", () => ({
  default: jest.fn(() => ({ end: pgEnd })),
}));
jest.unstable_mockModule("drizzle-orm/postgres-js", () => ({
  drizzle: jest.fn(() => ({})),
}));

const { resolveStripeKey, TierApplyMissingPricesError } =
  await import("../stripe.js");
const { lookupKey } = await import("../catalog.js");
const {
  tierApply,
  computeTierChanges,
  insertValuesFor,
  updateSetsFor,
  openEnvTierStore,
} = await import("../commands/tier.js");
const { TIER_CATALOG, TIER_CATALOG_BY_SLUG } =
  await import("@portalai/core/registries");

const local = BUILTIN_ENVIRONMENTS["local"];
const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

// ── Fixtures ──────────────────────────────────────────────────────────

const CATALOG_STANDARD = TIER_CATALOG_BY_SLUG.get("standard")!;

/** A live `tiers` row matching the catalog's standard entry exactly. */
const standardRow = (over: Record<string, unknown> = {}) => ({
  id: "row-standard",
  slug: "standard",
  displayName: CATALOG_STANDARD.displayName,
  periodKind: CATALOG_STANDARD.periodKind,
  periodAnchorDay: CATALOG_STANDARD.periodAnchorDay,
  overage: CATALOG_STANDARD.overage,
  freeUnitsPerPeriod: CATALOG_STANDARD.freeUnitsPerPeriod,
  freeRatePerMin: CATALOG_STANDARD.freeRatePerMin,
  meteredUnitsPerPeriod: CATALOG_STANDARD.meteredUnitsPerPeriod,
  meteredRatePerMin: CATALOG_STANDARD.meteredRatePerMin,
  expensiveUnitsPerPeriod: CATALOG_STANDARD.expensiveUnitsPerPeriod,
  expensiveRatePerMin: CATALOG_STANDARD.expensiveRatePerMin,
  perToolCaps: CATALOG_STANDARD.perToolCaps,
  stripePriceId: null,
  selectable: CATALOG_STANDARD.selectable,
  builtinToolpacks: [...CATALOG_STANDARD.builtinToolpacks],
  customToolpacks: CATALOG_STANDARD.customToolpacks,
  ...over,
});

/** A purchasable catalog entry for lookup-key scenarios. */
const proEntry = (over: Record<string, unknown> = {}) => ({
  ...CATALOG_STANDARD,
  slug: "pro",
  displayName: "Pro",
  stripeLookupKey: "pro",
  ...over,
});

/** In-memory TierStore: records applyChanges calls. */
const fakeStore = (rows: ReturnType<typeof standardRow>[]) => {
  const applied: unknown[][] = [];
  const store = {
    readAll: jest.fn(async () => rows as never),
    applyChanges: jest.fn(async (changes: unknown[]) => {
      applied.push(changes);
    }),
    close: jest.fn(async () => {}),
  };
  return { store, applied, factory: jest.fn(async () => store as never) };
};

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;
beforeEach(() => {
  resetCliEnvMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
});
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
});

// ── spec case 8 — resolveStripeKey (slice 2) ──────────────────────────

describe("resolveStripeKey (#218)", () => {
  it("local (aws: null) reads STRIPE_SECRET_KEY from the process env", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_local_123";
    await expect(resolveStripeKey(local as never)).resolves.toBe(
      "sk_test_local_123"
    );
  });

  it("local without the env var typed-throws EnvNotConfiguredError", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(resolveStripeKey(local as never)).rejects.toBeInstanceOf(
      EnvNotConfiguredError
    );
  });

  it("aws env delegates to the secret reader with the catalog leaf name", async () => {
    const readSecret = jest.fn(async () => "sk_test_appdev_456");
    await expect(
      resolveStripeKey(appDev as never, readSecret as never)
    ).resolves.toBe("sk_test_appdev_456");
    expect(readSecret).toHaveBeenCalledWith(appDev, "stripe-secret-key");
  });
});

// ── the config-catalog pin (slice 2) ──────────────────────────────────

describe("STRIPE_SECRET_KEY config-catalog entry (#218)", () => {
  it("resolves as a Secrets Manager entry with the stripe-secret-key leaf", () => {
    const entry = lookupKey("STRIPE_SECRET_KEY");
    expect(entry.kind).toBe("secret");
    expect(entry.name).toBe("stripe-secret-key");
  });
});

describe("TierApplyMissingPricesError (#218)", () => {
  it("names every missing lookup key and the runbook", () => {
    const err = new TierApplyMissingPricesError(["pro", "scale"]);
    expect(err.missingLookupKeys).toEqual(["pro", "scale"]);
    expect(err.message).toContain("pro");
    expect(err.message).toContain("scale");
    expect(err.message).toMatch(/create the price/i);
  });
});

// ── spec case 3 — dry-run purity ──────────────────────────────────────

describe("tierApply --dry-run (#218 case 3)", () => {
  it("computes the diff with NO guard, NO writes, NO audit", async () => {
    const { store, factory } = fakeStore([
      standardRow({ selectable: false }), // drifted
      standardRow({ id: "row-ent", slug: "enterprise-x" }), // undeclared
    ]);

    const result = await tierApply(
      local as never,
      { dryRun: true },
      { store: factory as never }
    );

    expect(result.dryRun).toBe(true);
    const standard = result.changes.find((c) => c.slug === "standard")!;
    expect(standard.action).toBe("update");
    expect(standard.fields).toEqual({
      selectable: { from: false, to: true },
    });
    expect(result.unmanaged).toEqual(["enterprise-x"]);

    expect(mocks.assertOperationAllowed).not.toHaveBeenCalled();
    expect(store.applyChanges).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(store.close).toHaveBeenCalled();
  });
});

// ── spec case 4 — fail-closed on missing prices ───────────────────────

describe("tierApply missing lookup keys (#218 case 4)", () => {
  it("throws TierApplyMissingPricesError before any DB contact", async () => {
    const { factory } = fakeStore([]);
    const resolvePrices = jest.fn(async () => new Map<string, string>());

    await expect(
      tierApply(
        local as never,
        {},
        {
          catalog: [proEntry()] as never,
          resolvePrices: resolvePrices as never,
          store: factory as never,
        }
      )
    ).rejects.toBeInstanceOf(TierApplyMissingPricesError);

    expect(resolvePrices).toHaveBeenCalledWith("sk_test_fixture", ["pro"]);
    expect(factory).not.toHaveBeenCalled(); // no DB contact
  });
});

// ── spec case 5 — field-level convergence ─────────────────────────────

describe("tierApply convergence (#218 case 5)", () => {
  it("adopts the resolved price id and diffs jsonb fields", async () => {
    const { store, factory } = fakeStore([
      standardRow({
        id: "row-pro",
        slug: "pro",
        displayName: "Pro",
        stripePriceId: null,
        builtinToolpacks: ["data_query"], // narrower than catalog
      }),
    ]);
    const resolvePrices = jest.fn(
      async () => new Map([["pro", "price_env_123"]])
    );

    const result = await tierApply(
      local as never,
      { yes: true },
      {
        catalog: [proEntry()] as never,
        resolvePrices: resolvePrices as never,
        store: factory as never,
      }
    );

    const pro = result.changes.find((c) => c.slug === "pro")!;
    expect(pro.action).toBe("update");
    expect(pro.fields.stripePriceId).toEqual({
      from: null,
      to: "price_env_123",
    });
    expect(pro.fields.builtinToolpacks).toEqual({
      from: ["data_query"],
      to: [...CATALOG_STANDARD.builtinToolpacks],
    });
    expect(store.applyChanges).toHaveBeenCalledTimes(1);
  });

  it("a null stripeLookupKey converges stripe_price_id back to NULL", async () => {
    const { factory } = fakeStore([
      standardRow({ stripePriceId: "price_stale_999" }),
    ]);

    const result = await tierApply(
      local as never,
      { dryRun: true },
      { store: factory as never }
    );

    const standard = result.changes.find((c) => c.slug === "standard")!;
    expect(standard.fields.stripePriceId).toEqual({
      from: "price_stale_999",
      to: null,
    });
  });

  it("an absent row becomes an insert carrying every converged field", async () => {
    const { factory } = fakeStore([]);

    const result = await tierApply(
      local as never,
      { dryRun: true },
      { store: factory as never }
    );

    const standard = result.changes.find((c) => c.slug === "standard")!;
    expect(standard.action).toBe("insert");
    expect(standard.fields.displayName).toEqual({
      from: null,
      to: "Standard",
    });
    expect(standard.fields.selectable).toEqual({ from: null, to: true });
    expect(standard.stripePriceId).toBeNull();
  });
});

// ── spec case 6 — undeclared rows untouched ───────────────────────────

describe("tierApply converge-declared-only (#218 case 6)", () => {
  it("never writes undeclared rows; lists them as unmanaged", async () => {
    const { store, factory } = fakeStore([
      standardRow({ selectable: false }),
      standardRow({
        id: "row-ent",
        slug: "enterprise-acme",
        displayName: "Acme Deal",
      }),
    ]);

    const result = await tierApply(
      local as never,
      { yes: true },
      { store: factory as never }
    );

    expect(result.unmanaged).toEqual(["enterprise-acme"]);
    const written = store.applyChanges.mock.calls[0][0] as {
      slug: string;
    }[];
    expect(written.map((c) => c.slug)).toEqual(["standard"]);
  });
});

// ── spec case 7 — real run: guard once, audit per changed slug ────────

describe("tierApply real run (#218 case 7)", () => {
  it("guards once, applies dirty changes only, audits per changed slug", async () => {
    const { store, factory } = fakeStore([standardRow({ selectable: false })]);

    const result = await tierApply(
      local as never,
      { yes: true },
      { store: factory as never }
    );

    expect(result.dryRun).toBe(false);
    expect(mocks.assertOperationAllowed).toHaveBeenCalledTimes(1);
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(
      local,
      expect.objectContaining({ destructive: false, confirmed: true })
    );
    expect(store.applyChanges).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        env: "local",
        operator: "portalops",
        command: "tier apply",
        args: expect.objectContaining({
          slug: "standard",
          action: "update",
          fields: ["selectable"],
        }),
      })
    );
  });

  it("an all-noop run needs no guard, writes nothing, audits nothing", async () => {
    const { store, factory } = fakeStore([standardRow()]);

    const result = await tierApply(
      local as never,
      {},
      { store: factory as never }
    );

    expect(result.changes[0].action).toBe("noop");
    expect(mocks.assertOperationAllowed).not.toHaveBeenCalled();
    expect(store.applyChanges).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

// ── insert/update value builders (the real store's row shaping) ───────

describe("insertValuesFor / updateSetsFor (#218)", () => {
  it("insert values stamp id/created/createdBy portalops + all fields", () => {
    const { changes } = computeTierChanges(
      TIER_CATALOG as never,
      [],
      new Map()
    );
    const values = insertValuesFor(changes[0]);
    expect(values.slug).toBe("standard");
    expect(values.createdBy).toBe("portalops");
    expect(typeof values.id).toBe("string");
    expect(typeof values.created).toBe("number");
    expect(values.displayName).toBe("Standard");
    expect(values.selectable).toBe(true);
  });

  it("update sets carry changed fields + updated/updatedBy stamps only", () => {
    const { changes } = computeTierChanges(
      TIER_CATALOG as never,
      [standardRow({ selectable: false }) as never],
      new Map()
    );
    const sets = updateSetsFor(changes[0]);
    expect(sets.selectable).toBe(true);
    expect(sets.updatedBy).toBe("portalops");
    expect(typeof sets.updated).toBe("number");
    expect(sets).not.toHaveProperty("displayName"); // unchanged
    expect(sets).not.toHaveProperty("createdBy");
  });
});

// ── #242 — the default store disposes the tunnel on close ─────────────

describe("openEnvTierStore teardown (#242)", () => {
  /** A fake EnvConnection whose db()/dispose() are spies; `dispose` is the
   *  tunnel teardown the leak omitted. */
  const fakeConnection = () => {
    const dispose = jest.fn(async () => {});
    const handleClose = jest.fn(async () => {});
    const db = jest.fn(async () => ({
      connectionString: "postgres://u:p@localhost:5999/db",
      close: handleClose,
    }));
    const resolve = jest.fn(async (_name: string) => ({
      env: "app-dev",
      kind: "staging",
      apiBaseUrl: "",
      db,
      token: jest.fn(async () => ""),
      dispose,
    }));
    return { resolve, db, dispose };
  };

  beforeEach(() => pgEnd.mockReset().mockResolvedValue(undefined));

  it("close() ends the postgres client AND disposes the connection/tunnel", async () => {
    const order: string[] = [];
    pgEnd.mockImplementation(async () => {
      order.push("client.end");
    });
    const { resolve, dispose } = fakeConnection();
    dispose.mockImplementation(async () => {
      order.push("connection.dispose");
    });

    const store = await openEnvTierStore("app-dev", resolve as never);
    await store.close();

    expect(resolve).toHaveBeenCalledWith("app-dev");
    expect(pgEnd).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    // client closed first, tunnel freed after.
    expect(order).toEqual(["client.end", "connection.dispose"]);
  });

  it("disposes the connection even when the client close rejects (finally)", async () => {
    pgEnd.mockRejectedValue(new Error("pool already ended"));
    const { resolve, dispose } = fakeConnection();

    const store = await openEnvTierStore("app-dev", resolve as never);
    await expect(store.close()).rejects.toThrow("pool already ended");

    expect(dispose).toHaveBeenCalledTimes(1); // tunnel freed regardless
  });
});
