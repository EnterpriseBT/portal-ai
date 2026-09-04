/**
 * Demo dataset integrity (#508).
 *
 * Two layers of coverage:
 *   1. Generator invariants — call the synth functions and assert row counts,
 *      cross-entity join-key closure, and near-duplicate names. This is the
 *      logic #509 relies on when it streams the same generators at scale.
 *   2. Committed-file sync — the checked-in CSV/XLSX match the generators, so a
 *      "forgot to regenerate" diff fails CI rather than shipping stale data.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";

import {
  COUNTS,
  HEADERS,
  generateCustomers,
  generateNotes,
  generateOrders,
  generateProducts,
  generateShipments,
  generateSites,
} from "../fixtures/demo-data.js";

const SEED = "harborview";
const FIXTURES = fileURLToPath(
  new URL("../../fixtures/demo/", import.meta.url)
);

const customers = generateCustomers(SEED);
const products = generateProducts(SEED);
const sites = generateSites(SEED);
const orders = generateOrders(customers, products, SEED);
const shipments = generateShipments(sites, customers, SEED);
const notes = generateNotes(customers, SEED);

const customerIds = new Set(customers.map((c) => c.customer_id));
const productIds = new Set(products.map((p) => p.product_id));
const siteIds = new Set(sites.map((s) => s.site_id));

describe("demo dataset — generator invariants", () => {
  it("produces the target row counts", () => {
    expect(customers).toHaveLength(COUNTS.customers);
    expect(products).toHaveLength(COUNTS.products);
    expect(sites).toHaveLength(COUNTS.sites);
    expect(orders).toHaveLength(COUNTS.orders);
    expect(shipments).toHaveLength(COUNTS.shipments);
    expect(notes).toHaveLength(COUNTS.notes);
  });

  it("has unique primary keys", () => {
    expect(customerIds.size).toBe(customers.length);
    expect(productIds.size).toBe(products.length);
    expect(siteIds.size).toBe(sites.length);
  });

  it("closes every cross-entity join key", () => {
    for (const o of orders) {
      expect(customerIds.has(o.customer_id)).toBe(true);
      expect(productIds.has(o.product_id)).toBe(true);
    }
    for (const s of shipments) {
      expect(siteIds.has(s.origin_site_id)).toBe(true);
      expect(siteIds.has(s.dest_site_id)).toBe(true);
      expect(s.origin_site_id).not.toBe(s.dest_site_id);
      expect(customerIds.has(s.customer_id)).toBe(true);
    }
    for (const n of notes) {
      expect(customerIds.has(n.customer_id)).toBe(true);
    }
  });

  it("includes deliberate near-duplicate customer names (identity story)", () => {
    const uniqueNames = new Set(customers.map((c) => c.name));
    expect(uniqueNames.size).toBeLessThan(customers.length);
  });

  it("keeps geospatial coordinates in North-American bounds", () => {
    for (const c of customers) {
      expect(c.latitude).toBeGreaterThan(24);
      expect(c.latitude).toBeLessThan(50);
      expect(c.longitude).toBeGreaterThan(-125);
      expect(c.longitude).toBeLessThan(-66);
    }
  });

  it("is deterministic — same seed reproduces the first rows exactly", () => {
    const again = generateCustomers(SEED);
    expect(again[0]).toEqual(customers[0]);
    expect(again[COUNTS.customers - 1]).toEqual(
      customers[customers.length - 1]
    );
  });
});

/** Split a committed CSV (no embedded newlines in fields) into header + rows. */
function readCsv(name: string): { header: string; dataRows: number } {
  const text = readFileSync(`${FIXTURES}${name}`, "utf8");
  const lines = text.replace(/\n$/, "").split("\n");
  return { header: lines[0], dataRows: lines.length - 1 };
}

describe("demo dataset — committed files match the generators", () => {
  it.each([
    ["customers.csv", HEADERS.customers, COUNTS.customers],
    ["products.csv", HEADERS.products, COUNTS.products],
    ["sites.csv", HEADERS.sites, COUNTS.sites],
    ["shipments.csv", HEADERS.shipments, COUNTS.shipments],
    ["notes.csv", HEADERS.notes, COUNTS.notes],
  ] as const)(
    "%s has the right header and row count",
    (name, headers, count) => {
      const { header, dataRows } = readCsv(name);
      expect(header).toBe(headers.join(","));
      expect(dataRows).toBe(count);
    }
  );

  it("orders.xlsx carries all orders across year sheets with a clean header", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(`${FIXTURES}orders.xlsx`);
    let total = 0;
    wb.eachSheet((ws) => {
      const headerRow = ws.getRow(1).values as unknown[];
      // ExcelJS row.values is 1-indexed (values[0] is undefined).
      expect(headerRow.slice(1)).toEqual([...HEADERS.orders]);
      total += ws.rowCount - 1;
    });
    expect(total).toBe(COUNTS.orders);
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(2);
  });
});
