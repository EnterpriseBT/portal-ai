/**
 * Demo dataset manifest (#509) — the declarative map from each committed
 * fixture to its connector entity + field mappings, used by `DemoSeedService`.
 *
 * Every `columnKey` is a system column-definition key seeded per org
 * (`SeedService.seedSystemColumnDefinitions`); `normalizedKey` is the stable
 * per-mapping key (we use the source field name). Reference columns set
 * `refEntityKey` + `refColumnKey` to the target entity's `key` and the target
 * column's `normalizedKey`.
 *
 * Slice 2 wires `customers`; slice 3 extends this to every base entity.
 */

/** Which connector instance an entity's records hang off. */
export type DemoInstanceKind = "sandbox" | "file-upload";

export interface DemoMapping {
  /** Source column name in the fixture. */
  sourceField: string;
  /** System column-definition key (resolved to a columnDefinitionId per org). */
  columnKey: string;
  /** Stable per-mapping key; defaults to `sourceField`. */
  normalizedKey?: string;
  isPrimaryKey?: boolean;
  required?: boolean;
  /** For a reference column: the target entity's `key`. */
  refEntityKey?: string;
  /** For a reference column: the target column's `normalizedKey`. */
  refColumnKey?: string;
}

export interface DemoEntitySpec {
  /** Connector-entity key (unique per org). */
  key: string;
  label: string;
  instance: DemoInstanceKind;
  /** Fixture filename under apps/api/fixtures/demo. */
  file: string;
  format: "csv" | "xlsx";
  mappings: DemoMapping[];
}

const CUSTOMERS: DemoEntitySpec = {
  key: "customers",
  label: "Customers",
  instance: "sandbox",
  file: "customers.csv",
  format: "csv",
  mappings: [
    {
      sourceField: "customer_id",
      columnKey: "string_id",
      isPrimaryKey: true,
      required: true,
    },
    { sourceField: "name", columnKey: "name", required: true },
    { sourceField: "segment", columnKey: "enum" },
    { sourceField: "region", columnKey: "enum" },
    { sourceField: "signup_date", columnKey: "date" },
    { sourceField: "street_address", columnKey: "address" },
    { sourceField: "latitude", columnKey: "latitude" },
    { sourceField: "longitude", columnKey: "longitude" },
  ],
};

/** The demo entities, in seed order (referenced entities before referrers). */
export const DEMO_ENTITY_SPECS: DemoEntitySpec[] = [CUSTOMERS];
