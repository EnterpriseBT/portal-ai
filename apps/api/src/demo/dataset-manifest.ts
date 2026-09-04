/**
 * Demo dataset manifest (#509) — the declarative map from each committed
 * fixture to its connector entity + field mappings, used by `DemoSeedService`.
 *
 * Every `columnKey` is a system column-definition key seeded per org
 * (`SeedService.seedSystemColumnDefinitions`); `normalizedKey` is the stable
 * per-mapping key (we use the source field name). Reference columns use
 * `columnKey: "reference"` and set `refEntityKey` + `refColumnKey` to the target
 * entity's `key` and the target column's `normalizedKey`.
 *
 * `instance` names which connector instance an entity's records hang off. The
 * `.xlsx` fixtures ride the File Upload connector (which accepts CSV *and*
 * XLSX) — this is unrelated to the Microsoft 365 Excel *connector*, which is
 * dropped from the demo (#507 amendment).
 */

/** Which connector instance an entity's records hang off. */
export type DemoInstanceKind =
  | "sandbox"
  | "file-upload-csv"
  | "file-upload-xlsx"
  | "rest-api";

export interface DemoMapping {
  /** Source column name in the fixture. */
  sourceField: string;
  /** System column-definition key (resolved to a columnDefinitionId per org). */
  columnKey: string;
  /** Stable per-mapping key; defaults to `sourceField`. */
  normalizedKey?: string;
  isPrimaryKey?: boolean;
  required?: boolean;
  /** For a reference column (`columnKey: "reference"`): the target entity's `key`. */
  refEntityKey?: string;
  /** For a reference column: the target column's `normalizedKey`. */
  refColumnKey?: string;
}

export interface DemoEntitySpec {
  /** Connector-entity key (unique per org). */
  key: string;
  label: string;
  instance: DemoInstanceKind;
  /** Fixture filename (under apps/api/fixtures/demo, except inventory — see service). */
  file: string;
  format: "csv" | "xlsx" | "json";
  /** For xlsx: read only this sheet (omit to read all sheets, e.g. orders). */
  sheet?: string;
  mappings: DemoMapping[];
}

const pk = (sourceField: string): DemoMapping => ({
  sourceField,
  columnKey: "string_id",
  isPrimaryKey: true,
  required: true,
});

const ref = (
  sourceField: string,
  refEntityKey: string,
  refColumnKey: string
): DemoMapping => ({
  sourceField,
  columnKey: "reference",
  refEntityKey,
  refColumnKey,
});

const col = (sourceField: string, columnKey: string): DemoMapping => ({
  sourceField,
  columnKey,
});

/**
 * The demo entities, in seed order (referenced entities before referrers).
 */
export const DEMO_ENTITY_SPECS: DemoEntitySpec[] = [
  {
    key: "customers",
    label: "Customers",
    instance: "file-upload-csv",
    file: "customers.csv",
    format: "csv",
    mappings: [
      pk("customer_id"),
      { sourceField: "name", columnKey: "name", required: true },
      col("segment", "enum"),
      col("region", "enum"),
      col("signup_date", "date"),
      col("street_address", "address"),
      col("latitude", "latitude"),
      col("longitude", "longitude"),
    ],
  },
  {
    key: "products",
    label: "Products",
    instance: "file-upload-csv",
    file: "products.csv",
    format: "csv",
    mappings: [
      pk("product_id"),
      { sourceField: "name", columnKey: "name", required: true },
      col("category", "enum"),
      col("unit_price", "currency"),
      col("unit_cost", "currency"),
    ],
  },
  {
    key: "sites",
    label: "Sites",
    instance: "file-upload-csv",
    file: "sites.csv",
    format: "csv",
    mappings: [
      pk("site_id"),
      { sourceField: "name", columnKey: "name", required: true },
      col("type", "enum"),
      col("street_address", "address"),
      col("latitude", "latitude"),
      col("longitude", "longitude"),
    ],
  },
  {
    key: "shipments",
    label: "Shipments",
    instance: "file-upload-csv",
    file: "shipments.csv",
    format: "csv",
    mappings: [
      pk("shipment_id"),
      ref("origin_site_id", "sites", "site_id"),
      ref("dest_site_id", "sites", "site_id"),
      ref("customer_id", "customers", "customer_id"),
      col("ship_date", "date"),
      col("units", "quantity"),
      col("weight_kg", "decimal"),
    ],
  },
  {
    key: "notes",
    label: "Notes",
    instance: "file-upload-csv",
    file: "notes.csv",
    format: "csv",
    mappings: [
      pk("note_id"),
      ref("customer_id", "customers", "customer_id"),
      col("note", "text"),
      col("follow_up_date", "datetime"),
      col("status", "status"),
      col("tag", "tag"),
    ],
  },
  {
    key: "orders",
    label: "Orders",
    instance: "file-upload-xlsx",
    file: "orders.xlsx",
    format: "xlsx", // all sheets (one per year)
    mappings: [
      pk("order_id"),
      ref("customer_id", "customers", "customer_id"),
      ref("product_id", "products", "product_id"),
      col("order_date", "date"),
      col("quantity", "quantity"),
      col("amount", "currency"),
    ],
  },
  {
    key: "cash_flows",
    label: "Cash Flows",
    instance: "file-upload-xlsx",
    file: "financials.xlsx",
    format: "xlsx",
    sheet: "Cash Flows",
    mappings: [
      col("month", "date"),
      col("inflow", "currency"),
      col("outflow", "currency"),
      col("net", "currency"),
    ],
  },
  {
    key: "loan_schedule",
    label: "Loan Schedule",
    instance: "file-upload-xlsx",
    file: "financials.xlsx",
    format: "xlsx",
    sheet: "Loan Schedule",
    mappings: [
      col("period", "integer"),
      col("payment", "currency"),
      col("principal", "currency"),
      col("interest", "currency"),
      col("balance", "currency"),
    ],
  },
  {
    key: "portfolio",
    label: "Portfolio",
    instance: "file-upload-xlsx",
    file: "financials.xlsx",
    format: "xlsx",
    sheet: "Portfolio",
    mappings: [
      col("ticker", "code"),
      col("weight", "percentage"),
      col("price", "currency"),
      col("expected_return", "percentage"),
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    instance: "rest-api",
    file: "inventory.json",
    format: "json",
    mappings: [
      ref("product_id", "products", "product_id"),
      col("sku", "code"),
      col("on_hand", "quantity"),
      col("warehouse", "enum"),
      col("updated_at", "datetime"),
    ],
  },
];

/**
 * The large-volume `transactions` entity — synthesized (not a committed file),
 * so it rides the Sandbox instance and is seeded separately by DemoSeedService.
 */
export const TRANSACTIONS_ENTITY: {
  key: string;
  label: string;
  mappings: DemoMapping[];
} = {
  key: "transactions",
  label: "Transactions",
  mappings: [
    pk("transaction_id"),
    ref("customer_id", "customers", "customer_id"),
    ref("product_id", "products", "product_id"),
    ref("site_id", "sites", "site_id"),
    col("occurred_at", "datetime"),
    col("quantity", "quantity"),
    col("amount", "currency"),
    col("channel", "enum"),
  ],
};
