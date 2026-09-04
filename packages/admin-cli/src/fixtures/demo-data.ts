/**
 * Demo dataset — shared, deterministic synthesis (#508).
 *
 * The single source of truth for the fictional "Harborview Supply Co." demo
 * company. Two consumers import from here:
 *   1. `fixtures/demo/generate.ts` (authoring script, run via tsx) emits the
 *      committed CSV/XLSX fixtures from these generators.
 *   2. `portalai demo seed` (#509) imports {@link synthesizeTransactions} to
 *      stream ~1M rows straight into the batch-upsert primitives at seed time.
 *
 * Because both paths share this module, the committed sample and the seeded
 * volume can never diverge, and the integrity test that runs on the sample
 * validates the logic that runs at scale.
 *
 * This module is intentionally **dependency-free** (built-in JS only, no
 * `Math.random`, no `Date.now`) so it stays fully deterministic and can be
 * relocated (e.g. into apps/api) without re-plumbing if #509 runs the large
 * synth server-side. Every column name below is the source-of-truth for the
 * data dictionary in `docs/DEMO_ORG.runbook.md`.
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG — xmur3 (string → 32-bit seed) + mulberry32 (seed → RNG).
// ---------------------------------------------------------------------------

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small deterministic random helper seeded by a string. */
export class Rng {
  private next: () => number;

  constructor(seed: string) {
    this.next = mulberry32(xmur3(seed)());
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max) rounded to `decimals`. */
  range(min: number, max: number, decimals = 2): number {
    const v = min + this.next() * (max - min);
    const p = 10 ** decimals;
    return Math.round(v * p) / p;
  }

  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---------------------------------------------------------------------------
// Fixed anchors — no wall-clock. Dates are relative to ANCHOR so regeneration
// is byte-stable (the smoke gate asserts `git status` is clean after a re-run).
// ---------------------------------------------------------------------------

/** Reference "today" for the dataset: 2026-08-31 (UTC). */
export const ANCHOR_MS = Date.UTC(2026, 7, 31);
const DAY_MS = 86_400_000;

/** History span for time-series data: 30 months back from ANCHOR. */
export const HISTORY_MONTHS = 30;
const HISTORY_START_MS = ANCHOR_MS - HISTORY_MONTHS * 30 * DAY_MS;

/** ISO date (YYYY-MM-DD) from an epoch-ms value. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO datetime (no millis) from an epoch-ms value. */
function isoDateTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Domain vocabulary — the fictional company's shape.
// ---------------------------------------------------------------------------

export const COMPANY_NAME = "Harborview Supply Co.";

export const SEGMENTS = [
  "enterprise",
  "mid-market",
  "smb",
  "reseller",
] as const;
export const CHANNELS = [
  "online",
  "field-sales",
  "distributor",
  "retail",
] as const;
export const PRODUCT_CATEGORIES = [
  "power-tools",
  "safety",
  "fasteners",
  "outdoor",
  "electrical",
  "material-handling",
  "storage",
] as const;
export const SITE_TYPES = [
  "distribution-center",
  "warehouse",
  "cross-dock",
] as const;
export const NOTE_STATUSES = ["open", "in-progress", "resolved"] as const;
export const NOTE_TAGS = [
  "renewal",
  "support",
  "upsell",
  "onboarding",
  "billing",
] as const;

/** North American metros with base coordinates — the geocode/map story. */
const METROS = [
  {
    city: "Seattle",
    state: "WA",
    region: "West",
    lat: 47.6062,
    lng: -122.3321,
  },
  {
    city: "Portland",
    state: "OR",
    region: "West",
    lat: 45.5152,
    lng: -122.6784,
  },
  {
    city: "San Francisco",
    state: "CA",
    region: "West",
    lat: 37.7749,
    lng: -122.4194,
  },
  {
    city: "Los Angeles",
    state: "CA",
    region: "West",
    lat: 34.0522,
    lng: -118.2437,
  },
  { city: "Phoenix", state: "AZ", region: "West", lat: 33.4484, lng: -112.074 },
  { city: "Denver", state: "CO", region: "West", lat: 39.7392, lng: -104.9903 },
  { city: "Dallas", state: "TX", region: "South", lat: 32.7767, lng: -96.797 },
  {
    city: "Houston",
    state: "TX",
    region: "South",
    lat: 29.7604,
    lng: -95.3698,
  },
  { city: "Atlanta", state: "GA", region: "South", lat: 33.749, lng: -84.388 },
  { city: "Miami", state: "FL", region: "South", lat: 25.7617, lng: -80.1918 },
  {
    city: "Charlotte",
    state: "NC",
    region: "South",
    lat: 35.2271,
    lng: -80.8431,
  },
  {
    city: "Chicago",
    state: "IL",
    region: "Midwest",
    lat: 41.8781,
    lng: -87.6298,
  },
  {
    city: "Minneapolis",
    state: "MN",
    region: "Midwest",
    lat: 44.9778,
    lng: -93.265,
  },
  {
    city: "Columbus",
    state: "OH",
    region: "Midwest",
    lat: 39.9612,
    lng: -82.9988,
  },
  {
    city: "Kansas City",
    state: "MO",
    region: "Midwest",
    lat: 39.0997,
    lng: -94.5786,
  },
  {
    city: "New York",
    state: "NY",
    region: "Northeast",
    lat: 40.7128,
    lng: -74.006,
  },
  {
    city: "Boston",
    state: "MA",
    region: "Northeast",
    lat: 42.3601,
    lng: -71.0589,
  },
  {
    city: "Philadelphia",
    state: "PA",
    region: "Northeast",
    lat: 39.9526,
    lng: -75.1652,
  },
] as const;

const STREET_NAMES = [
  "Harbor",
  "Industrial",
  "Commerce",
  "Cascade",
  "Summit",
  "Foundry",
  "Riverside",
  "Cedar",
  "Meridian",
  "Ironwood",
  "Lakeshore",
  "Warehouse",
] as const;
const STREET_SUFFIXES = ["Ave", "Blvd", "Way", "Rd", "Pkwy", "St"] as const;

const NAME_PREFIXES = [
  "Cascade",
  "Summit",
  "Ironwood",
  "Harborview",
  "Redwood",
  "Granite",
  "Blue Ridge",
  "Northwind",
  "Copper Creek",
  "Silverline",
  "Meridian",
  "Timberline",
  "Coastal",
  "Highland",
  "Anchor",
] as const;
const NAME_NOUNS = [
  "Industrial",
  "Supply",
  "Outfitters",
  "Trading",
  "Logistics",
  "Hardware",
  "Provisions",
  "Distributors",
  "Works",
  "Contractors",
] as const;
const NAME_SUFFIXES = ["Co.", "LLC", "Inc.", "Group", "Partners", ""] as const;

// ---------------------------------------------------------------------------
// Row shapes — column names are the data-dictionary source of truth.
// ---------------------------------------------------------------------------

export interface Customer {
  customer_id: string;
  name: string;
  segment: string;
  region: string;
  signup_date: string;
  street_address: string;
  latitude: number;
  longitude: number;
}

export interface Product {
  product_id: string;
  name: string;
  category: string;
  unit_price: number;
  unit_cost: number;
}

export interface Site {
  site_id: string;
  name: string;
  type: string;
  street_address: string;
  latitude: number;
  longitude: number;
}

export interface Order {
  order_id: string;
  customer_id: string;
  product_id: string;
  order_date: string;
  quantity: number;
  amount: number;
}

export interface Shipment {
  shipment_id: string;
  origin_site_id: string;
  dest_site_id: string;
  customer_id: string;
  ship_date: string;
  units: number;
  weight_kg: number;
}

export interface Note {
  note_id: string;
  customer_id: string;
  note: string;
  follow_up_date: string;
  status: string;
  tag: string;
}

export interface Transaction {
  transaction_id: string;
  customer_id: string;
  product_id: string;
  site_id: string;
  occurred_at: string;
  quantity: number;
  amount: number;
  channel: string;
}

export interface CashFlow {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface LoanPayment {
  period: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export interface Holding {
  ticker: string;
  weight: number;
  price: number;
  expected_return: number;
}

export interface InventoryItem {
  product_id: string;
  sku: string;
  on_hand: number;
  warehouse: string;
  updated_at: string;
}

/** Ordered header lists (the CSV/XLSX column order and dictionary order). */
export const HEADERS = {
  customers: [
    "customer_id",
    "name",
    "segment",
    "region",
    "signup_date",
    "street_address",
    "latitude",
    "longitude",
  ],
  products: ["product_id", "name", "category", "unit_price", "unit_cost"],
  sites: ["site_id", "name", "type", "street_address", "latitude", "longitude"],
  orders: [
    "order_id",
    "customer_id",
    "product_id",
    "order_date",
    "quantity",
    "amount",
  ],
  shipments: [
    "shipment_id",
    "origin_site_id",
    "dest_site_id",
    "customer_id",
    "ship_date",
    "units",
    "weight_kg",
  ],
  notes: ["note_id", "customer_id", "note", "follow_up_date", "status", "tag"],
  transactions: [
    "transaction_id",
    "customer_id",
    "product_id",
    "site_id",
    "occurred_at",
    "quantity",
    "amount",
    "channel",
  ],
  cashFlows: ["month", "inflow", "outflow", "net"],
  loanSchedule: ["period", "payment", "principal", "interest", "balance"],
  portfolio: ["ticker", "weight", "price", "expected_return"],
  inventory: ["product_id", "sku", "on_hand", "warehouse", "updated_at"],
} as const satisfies Record<string, readonly string[]>;

// ---------------------------------------------------------------------------
// Target counts for the committed base dataset.
// ---------------------------------------------------------------------------

export const COUNTS = {
  customers: 800,
  products: 120,
  sites: 15,
  orders: 8000,
  shipments: 2500,
  notes: 40,
  /** Rows in the committed transactions *sample* (the ~1M volume is #509). */
  transactionsSample: 5000,
  cashFlowMonths: HISTORY_MONTHS,
  loanMonths: 60,
  portfolioHoldings: 10,
  inventory: 120,
} as const;

/** Loan terms for the amortization schedule (financial toolpack story). */
export const LOAN = {
  principal: 500_000,
  annualRate: 0.065,
  months: 60,
} as const;

const TICKERS = [
  "HRBV",
  "CSCD",
  "SMMT",
  "IRNW",
  "RDWD",
  "GRNT",
  "NRTH",
  "CPPR",
  "SLVR",
  "TMBR",
] as const;

const WAREHOUSES = [
  "Seattle-DC",
  "Dallas-DC",
  "Chicago-DC",
  "Atlanta-DC",
  "Newark-DC",
] as const;

const PAD = (n: number, width: number) => String(n).padStart(width, "0");

function makeAddress(rng: Rng, metro: (typeof METROS)[number]): string {
  const num = rng.int(100, 9999);
  const street = rng.pick(STREET_NAMES);
  const suffix = rng.pick(STREET_SUFFIXES);
  const zip = PAD(rng.int(10000, 99999), 5);
  return `${num} ${street} ${suffix}, ${metro.city}, ${metro.state} ${zip}`;
}

/** Jitter a metro's base coordinate slightly so points spread on the map. */
function jitter(rng: Rng, base: number): number {
  return Math.round((base + rng.range(-0.18, 0.18, 4)) * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Generators — each is pure and seeded, so output is fully reproducible.
// ---------------------------------------------------------------------------

export function generateCustomers(seed: string): Customer[] {
  const rng = new Rng(`${seed}:customers`);
  const out: Customer[] = [];
  for (let i = 1; i <= COUNTS.customers; i++) {
    const metro = rng.pick(METROS);
    const prefix = rng.pick(NAME_PREFIXES);
    const noun = rng.pick(NAME_NOUNS);
    const suffix = rng.pick(NAME_SUFFIXES);
    const name = `${prefix} ${noun}${suffix ? " " + suffix : ""}`;
    // Signup spread across the last ~4 years, before the order history begins.
    const signupMs = ANCHOR_MS - rng.int(90, 1460) * DAY_MS;
    out.push({
      customer_id: `CUST-${PAD(i, 5)}`,
      name,
      segment: rng.pick(SEGMENTS),
      region: metro.region,
      signup_date: isoDate(signupMs),
      street_address: makeAddress(rng, metro),
      latitude: jitter(rng, metro.lat),
      longitude: jitter(rng, metro.lng),
    });
  }
  // Inject a deliberate handful of near-duplicate names (identity resolution).
  const dupePatterns = [
    (base: string) => base.replace(/\.$|$/, " LLC"),
    (base: string) => `${base.split(" ")[0]} ${base.split(" ")[1]} Company`,
    (base: string) => base.toUpperCase(),
    (base: string) => `${base} Holdings`,
  ];
  for (let d = 0; d < 12; d++) {
    const src = out[rng.int(0, out.length - 1)];
    const pattern = dupePatterns[d % dupePatterns.length];
    const twin = out[rng.int(0, out.length - 1)];
    twin.name = pattern(
      src.name.replace(/ (LLC|Inc\.|Co\.|Group|Partners)$/, "")
    );
  }
  return out;
}

export function generateProducts(seed: string): Product[] {
  const rng = new Rng(`${seed}:products`);
  const out: Product[] = [];
  for (let i = 1; i <= COUNTS.products; i++) {
    const cost = rng.range(4, 900);
    const margin = rng.range(1.15, 1.75, 3);
    out.push({
      product_id: `PROD-${PAD(i, 4)}`,
      name: `${rng.pick(NAME_PREFIXES)} ${rng.pick(PRODUCT_CATEGORIES)} ${PAD(i, 4)}`,
      category: rng.pick(PRODUCT_CATEGORIES),
      unit_price: Math.round(cost * margin * 100) / 100,
      unit_cost: cost,
    });
  }
  return out;
}

export function generateSites(seed: string): Site[] {
  const rng = new Rng(`${seed}:sites`);
  const out: Site[] = [];
  // Fixed distribution footprint — first N metros, deterministic order.
  for (let i = 0; i < COUNTS.sites; i++) {
    const metro = METROS[i % METROS.length];
    out.push({
      site_id: `SITE-${PAD(i + 1, 3)}`,
      name: `${metro.city} ${rng.pick(SITE_TYPES)}`,
      type: rng.pick(SITE_TYPES),
      street_address: makeAddress(rng, metro),
      latitude: jitter(rng, metro.lat),
      longitude: jitter(rng, metro.lng),
    });
  }
  return out;
}

export function generateOrders(
  customers: Customer[],
  products: Product[],
  seed: string
): Order[] {
  const rng = new Rng(`${seed}:orders`);
  const span = ANCHOR_MS - HISTORY_START_MS;
  const out: Order[] = [];
  for (let i = 1; i <= COUNTS.orders; i++) {
    const customer = customers[rng.int(0, customers.length - 1)];
    const product = products[rng.int(0, products.length - 1)];
    // Bias order volume upward over time so the series trends (forecast story).
    const t = rng.float() ** 0.7; // skew toward recent
    const orderMs = HISTORY_START_MS + Math.floor(t * span);
    const quantity = rng.int(1, 60);
    out.push({
      order_id: `ORD-${PAD(i, 7)}`,
      customer_id: customer.customer_id,
      product_id: product.product_id,
      order_date: isoDate(orderMs),
      quantity,
      amount: Math.round(quantity * product.unit_price * 100) / 100,
    });
  }
  return out;
}

export function generateShipments(
  sites: Site[],
  customers: Customer[],
  seed: string
): Shipment[] {
  const rng = new Rng(`${seed}:shipments`);
  const span = ANCHOR_MS - HISTORY_START_MS;
  const out: Shipment[] = [];
  for (let i = 1; i <= COUNTS.shipments; i++) {
    let origin = sites[rng.int(0, sites.length - 1)];
    let dest = sites[rng.int(0, sites.length - 1)];
    while (dest.site_id === origin.site_id) {
      dest = sites[rng.int(0, sites.length - 1)];
    }
    const shipMs = HISTORY_START_MS + Math.floor(rng.float() * span);
    const units = rng.int(5, 400);
    out.push({
      shipment_id: `SHIP-${PAD(i, 6)}`,
      origin_site_id: origin.site_id,
      dest_site_id: dest.site_id,
      customer_id: customers[rng.int(0, customers.length - 1)].customer_id,
      ship_date: isoDate(shipMs),
      units,
      weight_kg: Math.round(units * rng.range(0.5, 12) * 100) / 100,
    });
  }
  return out;
}

export function generateNotes(customers: Customer[], seed: string): Note[] {
  const rng = new Rng(`${seed}:notes`);
  const templates = [
    "Follow up on renewal quote",
    "Customer requested bulk pricing",
    "Escalated shipping delay",
    "Onboarding call scheduled",
    "Invoice dispute pending review",
    "Upsell opportunity: safety line",
    "Requested product catalog",
    "Contract up for renewal next quarter",
  ];
  const out: Note[] = [];
  for (let i = 1; i <= COUNTS.notes; i++) {
    const customer = customers[rng.int(0, customers.length - 1)];
    const followMs = ANCHOR_MS + rng.int(-20, 45) * DAY_MS;
    out.push({
      note_id: `NOTE-${PAD(i, 4)}`,
      customer_id: customer.customer_id,
      note: `${rng.pick(templates)} — ${customer.name}`,
      follow_up_date: isoDateTime(followMs),
      status: rng.pick(NOTE_STATUSES),
      tag: rng.pick(NOTE_TAGS),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Large-volume transactions — the demo's "handles big data" story.
// ---------------------------------------------------------------------------

/** Foreign keys the transaction synth references (seeded ids at scale). */
export interface TransactionRefs {
  customerIds: string[];
  productIds: string[];
  siteIds: string[];
}

/**
 * Stream `rowCount` transaction rows lazily — a generator, so it never
 * materializes a large array. The authoring script calls it with a small count
 * to emit `transactions.sample.csv`; #509 calls it with ~1M and pipes the
 * yielded rows straight into the batch-upsert primitives (chunked), so nothing
 * is held whole in memory on the 512 MB app-dev task.
 *
 * Deterministic: the same `seed` + `refs` reproduces the same rows in order.
 */
export function* synthesizeTransactions(
  rowCount: number,
  seed: string,
  refs: TransactionRefs
): Generator<Transaction> {
  const rng = new Rng(`${seed}:transactions`);
  const span = ANCHOR_MS - HISTORY_START_MS;
  const { customerIds, productIds, siteIds } = refs;
  for (let i = 1; i <= rowCount; i++) {
    // Skew occurrence toward recent months so the series trends upward.
    const t = rng.float() ** 0.7;
    const occurredMs = HISTORY_START_MS + Math.floor(t * span);
    const quantity = rng.int(1, 40);
    const amount = Math.round(quantity * rng.range(8, 400) * 100) / 100;
    yield {
      transaction_id: `TXN-${PAD(i, 9)}`,
      customer_id: customerIds[rng.int(0, customerIds.length - 1)],
      product_id: productIds[rng.int(0, productIds.length - 1)],
      site_id: siteIds[rng.int(0, siteIds.length - 1)],
      occurred_at: isoDateTime(occurredMs),
      quantity,
      amount,
      channel: rng.pick(CHANNELS),
    };
  }
}

/** Convenience: build {@link TransactionRefs} from generated base entities. */
export function transactionRefs(
  customers: Customer[],
  products: Product[],
  sites: Site[]
): TransactionRefs {
  return {
    customerIds: customers.map((c) => c.customer_id),
    productIds: products.map((p) => p.product_id),
    siteIds: sites.map((s) => s.site_id),
  };
}

// ---------------------------------------------------------------------------
// Financials — the financial toolpack story (NPV/IRR/XNPV, amortization).
// ---------------------------------------------------------------------------

/** Monthly cash flows across the history window — trends upward (net positive). */
export function generateCashFlows(seed: string): CashFlow[] {
  const rng = new Rng(`${seed}:cashflows`);
  const out: CashFlow[] = [];
  for (let m = 0; m < COUNTS.cashFlowMonths; m++) {
    const monthMs = HISTORY_START_MS + m * 30 * DAY_MS;
    // Inflow grows over time; outflow tracks it but leaves a positive net.
    const growth = 1 + m * 0.015;
    const inflow = Math.round(rng.range(180_000, 240_000) * growth * 100) / 100;
    const outflow = Math.round(inflow * rng.range(0.72, 0.9, 3) * 100) / 100;
    out.push({
      month: isoDate(monthMs),
      inflow,
      outflow,
      net: Math.round((inflow - outflow) * 100) / 100,
    });
  }
  return out;
}

/** Fixed-payment amortization schedule for {@link LOAN} — pure, no randomness. */
export function generateLoanSchedule(): LoanPayment[] {
  const r = LOAN.annualRate / 12;
  const n = LOAN.months;
  const payment = (LOAN.principal * r) / (1 - Math.pow(1 + r, -n));
  const out: LoanPayment[] = [];
  let balance = LOAN.principal;
  for (let period = 1; period <= n; period++) {
    const interest = balance * r;
    const principal = payment - interest;
    balance -= principal;
    out.push({
      period,
      payment: Math.round(payment * 100) / 100,
      principal: Math.round(principal * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      // Clamp the final rounding drift so the schedule closes at zero.
      balance: Math.round(Math.max(balance, 0) * 100) / 100,
    });
  }
  return out;
}

/** A small equity portfolio with weights summing to 1 (portfolio_metrics). */
export function generatePortfolio(seed: string): Holding[] {
  const rng = new Rng(`${seed}:portfolio`);
  const raw = TICKERS.map(() => rng.range(0.5, 2, 4));
  const total = raw.reduce((a, b) => a + b, 0);
  return TICKERS.map((ticker, i) => ({
    ticker,
    weight: Math.round((raw[i] / total) * 10000) / 10000,
    price: rng.range(12, 480),
    expected_return: rng.range(0.03, 0.18, 4),
  }));
}

// ---------------------------------------------------------------------------
// Inventory — the REST API connector source (served as static JSON on the site).
// ---------------------------------------------------------------------------

/** One inventory row per product, keyed by product_id (REST recordsPath=""). */
export function generateInventory(
  products: Product[],
  seed: string
): InventoryItem[] {
  const rng = new Rng(`${seed}:inventory`);
  return products.map((p, i) => ({
    product_id: p.product_id,
    sku: `SKU-${PAD(i + 1, 5)}`,
    on_hand: rng.int(0, 5000),
    warehouse: rng.pick(WAREHOUSES),
    updated_at: isoDateTime(ANCHOR_MS - rng.int(0, 20) * DAY_MS),
  }));
}
