/**
 * Demo dataset emit script (#508) — authoring tooling, run via tsx:
 *   npm run --workspace @portalai/admin-cli fixtures:demo
 *
 * Writes the committed fictional-company fixtures into this directory from the
 * deterministic generators in `src/fixtures/demo-data.ts`. Not part of the
 * built CLI (excluded from tsconfig.build / eslint src). CSV and JSON outputs
 * are byte-stable across runs; XLSX workbook dates are pinned to the anchor so
 * regeneration produces content-equivalent files (zip timestamps aside).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import ExcelJS from "exceljs";

import {
  ANCHOR_MS,
  COMPANY_NAME,
  COUNTS,
  HEADERS,
  generateCustomers,
  generateNotes,
  generateOrders,
  generateProducts,
  generateShipments,
  generateSites,
  synthesizeTransactions,
  transactionRefs,
} from "../../src/fixtures/demo-data.js";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const SEED = "harborview";

type Row = Record<string, string | number>;

/** RFC-4180-ish CSV: quote any field containing a comma, quote, or newline. */
function toCsv(headers: readonly string[], rows: Row[]): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

function writeCsv(name: string, headers: readonly string[], rows: Row[]): void {
  const path = join(OUT_DIR, name);
  writeFileSync(path, toCsv(headers, rows), "utf8");
  console.log(`  ${name.padEnd(24)} ${rows.length.toLocaleString()} rows`);
}

/** Add a sheet with a single clean header row + dense data (one region/sheet). */
function addSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  headers: readonly string[],
  rows: Row[]
): void {
  const ws = wb.addWorksheet(sheetName);
  ws.addRow([...headers]);
  for (const row of rows) {
    ws.addRow(headers.map((h) => row[h]));
  }
}

function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  // Pin dates to the anchor so the file doesn't churn on wall-clock alone.
  const anchor = new Date(ANCHOR_MS);
  wb.created = anchor;
  wb.modified = anchor;
  return wb;
}

async function main(): Promise<void> {
  console.log(`Generating ${COMPANY_NAME} demo dataset (seed="${SEED}")\n`);

  const customers = generateCustomers(SEED);
  const products = generateProducts(SEED);
  const sites = generateSites(SEED);
  const orders = generateOrders(customers, products, SEED);
  const shipments = generateShipments(sites, customers, SEED);
  const notes = generateNotes(customers, SEED);

  writeCsv("customers.csv", HEADERS.customers, customers as unknown as Row[]);
  writeCsv("products.csv", HEADERS.products, products as unknown as Row[]);
  writeCsv("sites.csv", HEADERS.sites, sites as unknown as Row[]);
  writeCsv("shipments.csv", HEADERS.shipments, shipments as unknown as Row[]);
  writeCsv("notes.csv", HEADERS.notes, notes as unknown as Row[]);

  // transactions.sample.csv — a small slice of the large-volume table. #509
  // streams ~1M of these from the same generator; here we emit only the sample.
  const refs = transactionRefs(customers, products, sites);
  const sample: Row[] = [];
  for (const t of synthesizeTransactions(
    COUNTS.transactionsSample,
    SEED,
    refs
  )) {
    sample.push(t as unknown as Row);
  }
  writeCsv("transactions.sample.csv", HEADERS.transactions, sample);

  // orders.xlsx — one sheet per calendar year (gives the layout wizard work).
  const byYear = new Map<string, Row[]>();
  for (const o of orders) {
    const year = o.order_date.slice(0, 4);
    (byYear.get(year) ?? byYear.set(year, []).get(year)!).push(
      o as unknown as Row
    );
  }
  const wb = newWorkbook();
  for (const year of [...byYear.keys()].sort()) {
    addSheet(wb, year, HEADERS.orders, byYear.get(year)!);
  }
  await wb.xlsx.writeFile(join(OUT_DIR, "orders.xlsx"));
  console.log(
    `  ${"orders.xlsx".padEnd(24)} ${orders.length.toLocaleString()} rows across ${byYear.size} sheets`
  );

  console.log(`\nDone. Wrote to ${OUT_DIR}`);
  void COUNTS;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
