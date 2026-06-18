import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindByStationId = jest.fn<() => Promise<unknown[]>>();
const mockFindByConnectorInstanceId = jest.fn<() => Promise<unknown[]>>();
const mockFindFieldMappingsByEntityIds =
  jest.fn<() => Promise<Map<string, unknown[]>>>();
const mockFindByConnectorEntityId_records = jest.fn<() => Promise<unknown[]>>();
const mockFindByConnectorEntityId_members = jest.fn<() => Promise<unknown[]>>();
const mockFindByEntityGroupId = jest.fn<() => Promise<unknown[]>>();
const mockFindById_group = jest.fn<() => Promise<unknown>>();
const mockFindMany_entities = jest.fn<() => Promise<unknown[]>>();
const mockFindByOrganizationId_colDefs = jest
  .fn<() => Promise<unknown[]>>()
  .mockResolvedValue([]);

// Mock vega/vega-lite so data-injection tests don't require valid specs.
// Dedicated validation tests use the real modules.
const mockVegaParse = jest.fn<() => unknown>().mockReturnValue({});
const mockViewRunAsync = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const mockViewFinalize = jest.fn<() => void>();

jest.unstable_mockModule("vega", () => ({
  parse: mockVegaParse,
  View: class {
    runAsync = mockViewRunAsync;
    finalize = mockViewFinalize;
  },
}));

jest.unstable_mockModule("vega-lite", () => ({
  compile: jest.fn<() => unknown>().mockReturnValue({ spec: {} }),
}));

// Mock direct db import for _connector_instances metadata query in loadStation
const _mockSelectChain = {
  from: () => _mockSelectChain,
  where: () => Promise.resolve([]),
};
jest.unstable_mockModule("../../db/client.js", () => ({
  db: { select: () => _mockSelectChain },
}));

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      stationInstances: {
        findByStationId: mockFindByStationId,
      },
      connectorEntities: {
        findByConnectorInstanceId: mockFindByConnectorInstanceId,
        findFieldMappingsByEntityIds: mockFindFieldMappingsByEntityIds,
        findMany: mockFindMany_entities,
      },
      entityRecords: {
        findByConnectorEntityId: mockFindByConnectorEntityId_records,
        findHydratedMany: mockFindByConnectorEntityId_records,
      },
      entityGroupMembers: {
        findByConnectorEntityId: mockFindByConnectorEntityId_members,
        findByEntityGroupId: mockFindByEntityGroupId,
      },
      entityGroups: {
        findById: mockFindById_group,
      },
      columnDefinitions: {
        findByOrganizationId: mockFindByOrganizationId_colDefs,
      },
    },
  },
}));

const { AnalyticsService } =
  await import("../../services/analytics.service.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATION_ID = "station-001";
const ORG_ID = "org-001";

const STATION_INSTANCES = [
  { id: "si-1", stationId: STATION_ID, connectorInstanceId: "ci-1" },
  { id: "si-2", stationId: STATION_ID, connectorInstanceId: "ci-2" },
];

const ENTITIES = [
  {
    id: "ent-1",
    key: "customers",
    label: "Customers",
    connectorInstanceId: "ci-1",
  },
  { id: "ent-2", key: "orders", label: "Orders", connectorInstanceId: "ci-1" },
  {
    id: "ent-3",
    key: "products",
    label: "Products",
    connectorInstanceId: "ci-2",
  },
];

const FIELD_MAPPINGS_MAP = new Map<string, unknown[]>([
  [
    "ent-1",
    [
      {
        id: "fm-1",
        connectorEntityId: "ent-1",
        columnDefinitionId: "cd-1",
        columnDefinition: { key: "name", label: "Name", type: "string" },
      },
      {
        id: "fm-2",
        connectorEntityId: "ent-1",
        columnDefinitionId: "cd-2",
        columnDefinition: { key: "email", label: "Email", type: "string" },
      },
      {
        id: "fm-3",
        connectorEntityId: "ent-1",
        columnDefinitionId: "cd-3",
        columnDefinition: {
          key: "customer_id",
          label: "Customer ID",
          type: "string",
        },
      },
    ],
  ],
  [
    "ent-2",
    [
      {
        id: "fm-4",
        connectorEntityId: "ent-2",
        columnDefinitionId: "cd-4",
        columnDefinition: {
          key: "order_id",
          label: "Order ID",
          type: "string",
        },
      },
      {
        id: "fm-5",
        connectorEntityId: "ent-2",
        columnDefinitionId: "cd-5",
        columnDefinition: { key: "amount", label: "Amount", type: "number" },
      },
      {
        id: "fm-6",
        connectorEntityId: "ent-2",
        columnDefinitionId: "cd-6",
        columnDefinition: {
          key: "customer_id",
          label: "Customer ID",
          type: "string",
        },
      },
    ],
  ],
  [
    "ent-3",
    [
      {
        id: "fm-7",
        connectorEntityId: "ent-3",
        columnDefinitionId: "cd-7",
        columnDefinition: {
          key: "product_name",
          label: "Product Name",
          type: "string",
        },
      },
      {
        id: "fm-8",
        connectorEntityId: "ent-3",
        columnDefinitionId: "cd-8",
        columnDefinition: { key: "price", label: "Price", type: "number" },
      },
    ],
  ],
]);

const CUSTOMER_RECORDS = [
  {
    id: "r1",
    normalizedData: {
      name: "Alice",
      email: "alice@example.com",
      customer_id: "C001",
    },
  },
  {
    id: "r2",
    normalizedData: {
      name: "Bob",
      email: "bob@example.com",
      customer_id: "C002",
    },
  },
  {
    id: "r3",
    normalizedData: {
      name: "Charlie",
      email: "charlie@example.com",
      customer_id: "C003",
    },
  },
];

const ORDER_RECORDS = [
  {
    id: "r4",
    normalizedData: { order_id: "O001", amount: 100, customer_id: "C001" },
  },
  {
    id: "r5",
    normalizedData: { order_id: "O002", amount: 250, customer_id: "C002" },
  },
  {
    id: "r6",
    normalizedData: { order_id: "O003", amount: 75, customer_id: "C001" },
  },
  {
    id: "r7",
    normalizedData: { order_id: "O004", amount: 300, customer_id: "C003" },
  },
];

const PRODUCT_RECORDS = [
  { id: "r8", normalizedData: { product_name: "Widget", price: 19.99 } },
  { id: "r9", normalizedData: { product_name: "Gadget", price: 49.99 } },
];

/** Numeric fixture records for statistics/regression/financial tests. */
const NUMERIC_RECORDS = [
  { x: 1, y: 2.1, val: 100, date: "2024-01-01" },
  { x: 2, y: 3.9, val: 105, date: "2024-01-02" },
  { x: 3, y: 6.2, val: 102, date: "2024-01-03" },
  { x: 4, y: 7.8, val: 110, date: "2024-01-04" },
  { x: 5, y: 10.1, val: 108, date: "2024-01-05" },
  { x: 6, y: 12.0, val: 115, date: "2024-01-06" },
  { x: 7, y: 13.9, val: 120, date: "2024-01-07" },
  { x: 8, y: 16.1, val: 118, date: "2024-01-08" },
  { x: 9, y: 17.8, val: 125, date: "2024-01-09" },
  { x: 10, y: 20.2, val: 130, date: "2024-01-10" },
  { x: 11, y: 22.0, val: 128, date: "2024-01-11" },
  { x: 12, y: 23.9, val: 135, date: "2024-01-12" },
  { x: 13, y: 26.1, val: 140, date: "2024-01-13" },
  { x: 14, y: 27.8, val: 138, date: "2024-01-14" },
  { x: 15, y: 30.2, val: 145, date: "2024-01-15" },
];

/** Time-series fixture for trend tests. */
const TIMESERIES_RECORDS = [
  { date: "2024-01-15", revenue: 1000 },
  { date: "2024-01-20", revenue: 1200 },
  { date: "2024-02-10", revenue: 1100 },
  { date: "2024-02-25", revenue: 1300 },
  { date: "2024-03-05", revenue: 1500 },
  { date: "2024-03-18", revenue: 1400 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupLoadStationMocks(): void {
  mockFindByStationId.mockResolvedValue(STATION_INSTANCES);
  mockFindByConnectorInstanceId
    .mockResolvedValueOnce([ENTITIES[0], ENTITIES[1]])
    .mockResolvedValueOnce([ENTITIES[2]]);
  mockFindFieldMappingsByEntityIds.mockResolvedValue(FIELD_MAPPINGS_MAP);
  mockFindByConnectorEntityId_records
    .mockResolvedValueOnce(CUSTOMER_RECORDS)
    .mockResolvedValueOnce(ORDER_RECORDS)
    .mockResolvedValueOnce(PRODUCT_RECORDS);
  // No entity groups by default
  mockFindByConnectorEntityId_members.mockResolvedValue([]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnalyticsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Phase 3 slice 5: `AnalyticsService.cleanup` no longer exists — the
    // station's in-memory AlaSQL state went with the slice. Nothing to
    // clean up here.
  });

  // -----------------------------------------------------------------------
  // loadStation
  // -----------------------------------------------------------------------

  describe("loadStation()", () => {
    it("returns entity metadata and entity groups (no records map after slice 5)", async () => {
      setupLoadStationMocks();

      const result = await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      expect(result.entities).toHaveLength(3);
      expect(result.entities.map((e) => e.key)).toEqual([
        "customers",
        "orders",
        "products",
      ]);

      // Columns built from field mappings
      const customersEntity = result.entities.find(
        (e) => e.key === "customers"
      )!;
      expect(customersEntity.columns).toHaveLength(3);
      expect(customersEntity.columns.map((c) => c.key)).toContain("name");
      expect(customersEntity.columns.map((c) => c.key)).toContain("email");

      // The records map is gone — loadStation is metadata-only after
      // Phase 3 slice 5.
      expect("records" in result).toBe(false);
    });

    it("returns empty entities/entityGroups when station has no connector instances", async () => {
      mockFindByStationId.mockResolvedValue([]);

      const result = await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      expect(result.entities).toHaveLength(0);
      expect(result.entityGroups).toHaveLength(0);
    });

    it("should return empty when station has no entities", async () => {
      mockFindByStationId.mockResolvedValue(STATION_INSTANCES);
      mockFindByConnectorInstanceId.mockResolvedValue([]);

      const result = await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      expect(result.entities).toHaveLength(0);
    });

    it("should return entityGroups with correct members and link columns when Entity Groups exist", async () => {
      setupLoadStationMocks();

      // Set up entity group mocks — group links customers and orders by customer_id
      const groupId = "eg-1";
      mockFindByConnectorEntityId_members
        .mockReset()
        .mockResolvedValueOnce([
          { id: "egm-1", entityGroupId: groupId, connectorEntityId: "ent-1" },
        ])
        .mockResolvedValueOnce([
          { id: "egm-2", entityGroupId: groupId, connectorEntityId: "ent-2" },
        ])
        .mockResolvedValueOnce([]); // products has no group memberships

      mockFindById_group.mockResolvedValue({
        id: groupId,
        name: "Customer Identity",
        organizationId: ORG_ID,
      });

      mockFindByEntityGroupId.mockResolvedValue([
        {
          id: "egm-1",
          entityGroupId: groupId,
          connectorEntityId: "ent-1",
          linkFieldMappingId: "fm-3",
          isPrimary: true,
          connectorEntity: ENTITIES[0],
          fieldMapping: { id: "fm-3", columnDefinitionId: "cd-3" },
          columnDefinition: { key: "customer_id", label: "Customer ID" },
        },
        {
          id: "egm-2",
          entityGroupId: groupId,
          connectorEntityId: "ent-2",
          linkFieldMappingId: "fm-6",
          isPrimary: false,
          connectorEntity: ENTITIES[1],
          fieldMapping: { id: "fm-6", columnDefinitionId: "cd-6" },
          columnDefinition: { key: "customer_id", label: "Customer ID" },
        },
      ]);

      const result = await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      expect(result.entityGroups).toHaveLength(1);
      const group = result.entityGroups[0];
      expect(group.name).toBe("Customer Identity");
      expect(group.members).toHaveLength(2);

      const primaryMember = group.members.find((m) => m.isPrimary)!;
      expect(primaryMember.entityKey).toBe("customers");
      expect(primaryMember.linkColumnKey).toBe("customer_id");

      const secondaryMember = group.members.find((m) => !m.isPrimary)!;
      expect(secondaryMember.entityKey).toBe("orders");
      expect(secondaryMember.linkColumnKey).toBe("customer_id");
    });

    it("should return empty entityGroups when no groups have ≥2 loaded members", async () => {
      setupLoadStationMocks();

      // Only one entity is a member of a group
      const groupId = "eg-1";
      mockFindByConnectorEntityId_members
        .mockReset()
        .mockResolvedValueOnce([
          { id: "egm-1", entityGroupId: groupId, connectorEntityId: "ent-1" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockFindById_group.mockResolvedValue({
        id: groupId,
        name: "Lonely Group",
        organizationId: ORG_ID,
      });

      mockFindByEntityGroupId.mockResolvedValue([
        {
          id: "egm-1",
          entityGroupId: groupId,
          connectorEntityId: "ent-1",
          linkFieldMappingId: "fm-3",
          isPrimary: true,
          connectorEntity: ENTITIES[0],
          fieldMapping: { id: "fm-3", columnDefinitionId: "cd-3" },
          columnDefinition: { key: "customer_id", label: "Customer ID" },
        },
      ]);

      const result = await AnalyticsService.loadStation(STATION_ID, ORG_ID);
      expect(result.entityGroups).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // sqlQuery
  // -----------------------------------------------------------------------

  // Phase 3 slice 2: sqlQuery moved off AlaSQL onto Postgres-direct and
  // these AlaSQL-shaped expectations (`[customers]`, "Blocked SQL operation",
  // "Station not loaded") no longer match. Slice 5 deletes the AlaSQL surface
  // entirely and replaces these tests with new envelope-shape assertions
  // alongside the new Postgres-direct integration suite at
  // `apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`.
  describe.skip("sqlQuery() — AlaSQL-coupled, retired in slice 2", () => {
    it("placeholder — see portal-sql.service.integration.test.ts", () => {
      expect(true).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // visualize / visualizeVega
  //
  // Phase 3 slice 2: both helpers now route through the Postgres-direct
  // `sqlQuery` (no AlaSQL fixture path), so the AlaSQL-coupled spec
  // injection + Vega-validation tests below are out of scope until the
  // Postgres-direct path is fully wired in slice 5. The injection logic
  // itself (data array shaping, source-reference handling) is unchanged
  // and continues to be exercised end-to-end via portal-session tests.
  // -----------------------------------------------------------------------

  describe.skip("visualize() — AlaSQL-coupled, retired in slice 2", () => {
    it("placeholder", () => {
      expect(true).toBe(true);
    });
  });

  describe.skip("visualizeVega() — AlaSQL-coupled, retired in slice 2", () => {
    it("placeholder", () => {
      expect(true).toBe(true);
    });
  });

  describe.skip("visualize() validation — AlaSQL-coupled, retired in slice 2", () => {
    it("placeholder", () => {
      expect(true).toBe(true);
    });
  });

  describe.skip("visualizeVega() validation — AlaSQL-coupled, retired in slice 2", () => {
    it("placeholder", () => {
      expect(true).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // resolveIdentity
  // -----------------------------------------------------------------------

  // Phase 3 slice 3: resolveIdentity now reads from the phase-2 wide
  // tables (via `wideTableRepo.fetchProjectedRows`) instead of the AlaSQL
  // preload. The old unit tests below seeded AlaSQL via `loadStation` —
  // they no longer drive the new code path. Integration-level coverage
  // for the Postgres-direct surface lives in
  // `apps/api/src/__tests__/__integration__/services/analytics-resolve-identity.integration.test.ts`.
  describe.skip("resolveIdentity() — AlaSQL-coupled, retired in slice 3", () => {
    it("placeholder", () => {
      expect(true).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // describeColumn
  // -----------------------------------------------------------------------

  describe("describeColumn()", () => {
    it("should return descriptive statistics for a numeric column", () => {
      const result = AnalyticsService.describeColumn({
        records: NUMERIC_RECORDS,
        column: "x",
      });

      expect(result.count).toBe(15);
      expect(result.mean).toBe(8);
      expect(result.min).toBe(1);
      expect(result.max).toBe(15);
      expect(result.median).toBe(8);
      expect(result.p25).toBeGreaterThan(0);
      expect(result.p75).toBeLessThanOrEqual(15);
      expect(result.stddev).toBeGreaterThan(0);
    });

    it("should return zeros for empty records", () => {
      const result = AnalyticsService.describeColumn({
        records: [],
        column: "x",
      });

      expect(result.count).toBe(0);
      expect(result.mean).toBe(0);
    });

    it("includes variance, mode, skewness, kurtosis, and iqr as always-present fields", () => {
      const result = AnalyticsService.describeColumn({
        records: NUMERIC_RECORDS,
        column: "x",
      });
      expect(typeof result.variance).toBe("number");
      expect(Number.isFinite(result.variance)).toBe(true);
      expect(typeof result.mode).toBe("number");
      expect(typeof result.skewness).toBe("number");
      expect(Number.isFinite(result.skewness)).toBe(true);
      expect(typeof result.kurtosis).toBe("number");
      expect(typeof result.iqr).toBe("number");
      // 1..15 has sample variance = 280/14 = 20
      expect(result.variance).toBeCloseTo(20, 9);
      // Symmetric integer sequence — skewness ≈ 0
      expect(Math.abs(result.skewness)).toBeLessThan(1e-9);
      // Uniform-like — excess kurtosis is negative (platykurtic)
      expect(result.kurtosis).toBeLessThan(0);
    });

    it("variance is the sample variance (n-1 divisor)", () => {
      const records = [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }];
      const result = AnalyticsService.describeColumn({ records, column: "x" });
      // Sample variance of [1..5] = 10/4 = 2.5
      expect(result.variance).toBe(2.5);
    });

    it("mode returns the smallest tied value on multimodal input", () => {
      const records = [{ x: 1 }, { x: 1 }, { x: 2 }, { x: 2 }, { x: 3 }];
      const result = AnalyticsService.describeColumn({ records, column: "x" });
      // simple-statistics returns the smallest mode on ties
      expect(result.mode).toBe(1);
    });

    it("skewness is positive for right-skewed data", () => {
      const records = [
        { x: 1 },
        { x: 1 },
        { x: 1 },
        { x: 2 },
        { x: 3 },
        { x: 10 },
      ];
      const result = AnalyticsService.describeColumn({ records, column: "x" });
      expect(result.skewness).toBeGreaterThan(0);
    });

    it("kurtosis is excess kurtosis (negative for uniform-like data)", () => {
      const records = Array.from({ length: 100 }, (_, i) => ({ x: i }));
      const result = AnalyticsService.describeColumn({ records, column: "x" });
      expect(result.kurtosis).toBeLessThan(0);
    });

    it("iqr equals p75 - p25", () => {
      const result = AnalyticsService.describeColumn({
        records: NUMERIC_RECORDS,
        column: "x",
      });
      expect(result.iqr).toBeCloseTo(result.p75 - result.p25, 9);
    });

    it("percentiles field is absent when the input is omitted", () => {
      const result = AnalyticsService.describeColumn({
        records: NUMERIC_RECORDS,
        column: "x",
      });
      expect("percentiles" in result).toBe(false);
    });

    it("percentiles: [0.05, 0.95] returns string-keyed entries", () => {
      const result = AnalyticsService.describeColumn({
        records: NUMERIC_RECORDS,
        column: "x",
        percentiles: [0.05, 0.95],
      });
      expect(result.percentiles).toBeDefined();
      expect(Object.keys(result.percentiles!)).toEqual(["0.05", "0.95"]);
      expect(typeof result.percentiles!["0.05"]).toBe("number");
      expect(typeof result.percentiles!["0.95"]).toBe("number");
      expect(result.percentiles!["0.05"]).toBeLessThan(result.percentiles!["0.95"]);
    });

    it("percentiles: [0, 1] returns the min and max", () => {
      const result = AnalyticsService.describeColumn({
        records: NUMERIC_RECORDS,
        column: "x",
        percentiles: [0, 1],
      });
      expect(result.percentiles!["0"]).toBe(result.min);
      expect(result.percentiles!["1"]).toBe(result.max);
    });

    it("percentiles: [] returns an empty (but present) percentiles map", () => {
      const result = AnalyticsService.describeColumn({
        records: NUMERIC_RECORDS,
        column: "x",
        percentiles: [],
      });
      expect(result.percentiles).toBeDefined();
      expect(Object.keys(result.percentiles!)).toHaveLength(0);
    });

    it("empty records preserves the zero-fill behavior and omits percentiles", () => {
      const result = AnalyticsService.describeColumn({
        records: [],
        column: "x",
        percentiles: [0.5],
      });
      expect(result.count).toBe(0);
      expect(result.mean).toBe(0);
      expect(result.variance).toBe(0);
      expect("percentiles" in result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // correlate
  // -----------------------------------------------------------------------

  describe("correlate()", () => {
    it("should return Pearson correlation close to 1 for linearly related columns", () => {
      const result = AnalyticsService.correlate({
        records: NUMERIC_RECORDS,
        columnA: "x",
        columnB: "y",
      });

      // x and y are strongly linearly correlated (y ≈ 2x)
      expect(result.correlation).toBeGreaterThan(0.99);
    });

    it("should throw for columns with fewer than 2 values", () => {
      expect(() =>
        AnalyticsService.correlate({
          records: [{ x: 1, y: 2 }],
          columnA: "x",
          columnB: "y",
        })
      ).toThrow("at least 2 values");
    });

    it("Spearman correlation is 1 on a perfectly monotonic non-linear relationship", () => {
      // y = x^3 — strictly monotonic but Pearson < 1
      const records = Array.from({ length: 10 }, (_, i) => ({
        x: i + 1,
        y: (i + 1) ** 3,
      }));
      const result = AnalyticsService.correlate({
        records,
        columnA: "x",
        columnB: "y",
        method: "spearman",
      });
      expect(result.correlation).toBeCloseTo(1, 9);
    });

    it("Spearman matches Pearson on a perfectly linear relationship", () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        x: i + 1,
        y: 2 * (i + 1) + 3,
      }));
      const result = AnalyticsService.correlate({
        records,
        columnA: "x",
        columnB: "y",
        method: "spearman",
      });
      expect(result.correlation).toBeCloseTo(1, 9);
    });

    it("Spearman handles ties (averaged ranks)", () => {
      const records = [
        { x: 1, y: 10 },
        { x: 2, y: 20 },
        { x: 2, y: 20 },
        { x: 3, y: 30 },
        { x: 4, y: 40 },
      ];
      const result = AnalyticsService.correlate({
        records,
        columnA: "x",
        columnB: "y",
        method: "spearman",
      });
      expect(result.correlation).toBeCloseTo(1, 9);
    });

    it("Kendall correlation is 1 on a perfectly monotonic relationship", () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        x: i + 1,
        y: (i + 1) ** 3,
      }));
      const result = AnalyticsService.correlate({
        records,
        columnA: "x",
        columnB: "y",
        method: "kendall",
      });
      expect(result.correlation).toBeCloseTo(1, 9);
    });

    it("Kendall correlation is -1 on a perfectly anti-monotonic relationship", () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        x: i + 1,
        y: -(i + 1),
      }));
      const result = AnalyticsService.correlate({
        records,
        columnA: "x",
        columnB: "y",
        method: "kendall",
      });
      expect(result.correlation).toBeCloseTo(-1, 9);
    });

    it("Kendall τ-b on a known fixture (no ties) matches scipy.stats.kendalltau", () => {
      // Reference: scipy.stats.kendalltau(
      //   [4, 7, 5, 6, 2, 3, 1], [4, 5, 6, 7, 2, 3, 1]
      // ).statistic === 0.8095238095238095  (== 17/21; concordant=19, discordant=2)
      const records = [
        { x: 4, y: 4 },
        { x: 7, y: 5 },
        { x: 5, y: 6 },
        { x: 6, y: 7 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
        { x: 1, y: 1 },
      ];
      const result = AnalyticsService.correlate({
        records,
        columnA: "x",
        columnB: "y",
        method: "kendall",
      });
      expect(result.correlation).toBeCloseTo(17 / 21, 9);
    });

    it("Kendall handles ties (τ-b denominator correction)", () => {
      // Hand-computed: x=[1,1,2,3,4], y=[1,2,2,3,4]
      // Pairs: 8 concordant, 0 discordant, 1 tied-only-on-x, 1 tied-only-on-y.
      // n0 = 5*4/2 = 10. denom = sqrt((10-1)(10-1)) = 9. τ-b = 8/9.
      const records = [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
        { x: 4, y: 4 },
      ];
      const result = AnalyticsService.correlate({
        records,
        columnA: "x",
        columnB: "y",
        method: "kendall",
      });
      expect(result.correlation).toBeCloseTo(8 / 9, 9);
    });

    it("respects the length-mismatch guard regardless of method", () => {
      expect(() =>
        AnalyticsService.correlate({
          records: [{ x: 1, y: 2 }],
          columnA: "x",
          columnB: "y",
          method: "spearman",
        })
      ).toThrow("at least 2 values");
    });
  });

  // -----------------------------------------------------------------------
  // detectOutliers
  // -----------------------------------------------------------------------

  describe("detectOutliers()", () => {
    it("should detect outliers using IQR method", () => {
      const records = [
        ...NUMERIC_RECORDS,
        { x: 100, y: 200, val: 999, date: "2024-01-16" }, // outlier
      ];

      const result = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "iqr",
      });

      expect(result.indices).toContain(15); // the outlier is at index 15
      expect(result.outliers.length).toBeGreaterThan(0);
      expect((result.outliers[0] as Record<string, unknown>).x).toBe(100);
    });

    it("should detect outliers using Z-score method", () => {
      const records = [
        ...NUMERIC_RECORDS,
        { x: 100, y: 200, val: 999, date: "2024-01-16" },
      ];

      const result = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "zscore",
      });

      expect(result.indices).toContain(15);
    });

    it("custom IQR threshold widens the inlier band", () => {
      const records = [
        ...NUMERIC_RECORDS,
        { x: 100, y: 200, val: 999, date: "2024-01-16" },
      ];
      // High threshold (3.0) is permissive; the extreme outlier at index 15
      // is still flagged but borderline points are not.
      const result = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "iqr",
        threshold: 3.0,
      });
      expect(result.indices).toContain(15);
    });

    it("custom Z-score threshold below default flags more points", () => {
      const records = [
        ...NUMERIC_RECORDS,
        { x: 100, y: 200, val: 999, date: "2024-01-16" },
      ];
      const strict = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "zscore",
        threshold: 1.5,
      });
      const loose = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "zscore",
      });
      expect(strict.indices.length).toBeGreaterThanOrEqual(loose.indices.length);
      expect(strict.indices).toContain(15);
    });

    it("MAD method flags the extreme outlier with default threshold (3.5)", () => {
      const records = [
        ...NUMERIC_RECORDS,
        { x: 100, y: 200, val: 999, date: "2024-01-16" },
      ];
      const result = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "mad",
      });
      expect(result.indices).toContain(15);
    });

    it("MAD method honors a tighter custom threshold", () => {
      const records = [
        ...NUMERIC_RECORDS,
        { x: 100, y: 200, val: 999, date: "2024-01-16" },
      ];
      const tight = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "mad",
        threshold: 1.5,
      });
      const loose = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "mad",
      });
      expect(tight.indices.length).toBeGreaterThanOrEqual(loose.indices.length);
    });

    it("MAD with zero spread returns no outliers", () => {
      const records = Array.from({ length: 5 }, () => ({ x: 5 }));
      const result = AnalyticsService.detectOutliers({
        records,
        column: "x",
        method: "mad",
      });
      expect(result).toEqual({ outliers: [], indices: [] });
    });
  });

  // -----------------------------------------------------------------------
  // cluster
  // -----------------------------------------------------------------------

  describe("cluster()", () => {
    it("should return k-means clusters and centroids", () => {
      const records = [
        { a: 1, b: 1 },
        { a: 1.5, b: 2 },
        { a: 2, b: 1 },
        { a: 10, b: 10 },
        { a: 11, b: 10 },
        { a: 10, b: 11 },
      ];

      const result = AnalyticsService.cluster({
        records,
        columns: ["a", "b"],
        k: 2,
      });

      expect(result.clusters).toHaveLength(6);
      expect(result.centroids).toHaveLength(2);

      // Records in the same cluster should be near each other
      const cluster0 = result.clusters[0];
      expect(result.clusters[1]).toBe(cluster0);
      expect(result.clusters[2]).toBe(cluster0);
    });

    it("should return empty for empty records", () => {
      const result = AnalyticsService.cluster({
        records: [],
        columns: ["a"],
        k: 2,
      });

      expect(result.clusters).toHaveLength(0);
      expect(result.centroids).toHaveLength(0);
    });

    it("should throw for non-numeric values", () => {
      expect(() =>
        AnalyticsService.cluster({
          records: [{ a: "text", b: 1 }],
          columns: ["a", "b"],
          k: 2,
        })
      ).toThrow('Non-numeric value in column "a"');
    });

    it("seed makes clustering deterministic across runs", () => {
      const records = [
        { a: 1, b: 1 },
        { a: 1.5, b: 2 },
        { a: 2, b: 1 },
        { a: 10, b: 10 },
        { a: 11, b: 10 },
        { a: 10, b: 11 },
      ];
      const r1 = AnalyticsService.cluster({
        records,
        columns: ["a", "b"],
        k: 2,
        seed: 42,
      });
      const r2 = AnalyticsService.cluster({
        records,
        columns: ["a", "b"],
        k: 2,
        seed: 42,
      });
      expect(r2.clusters).toEqual(r1.clusters);
      expect(r2.centroids).toEqual(r1.centroids);
    });

    it("standardize: true produces partition-equivalent assignments to a manually-standardized fit", () => {
      const records = [
        { a: 0.1, b: 100 },
        { a: 0.2, b: 200 },
        { a: 0.15, b: 150 },
        { a: 0.8, b: 800 },
        { a: 0.9, b: 900 },
        { a: 0.85, b: 850 },
      ];
      const cols = ["a", "b"] as const;
      const aVals = records.map((r) => r.a);
      const bVals = records.map((r) => r.b);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const stddev = (xs: number[]) => {
        const m = mean(xs);
        return Math.sqrt(
          xs.reduce((acc, v) => acc + (v - m) ** 2, 0) / (xs.length - 1)
        );
      };
      const meanA = mean(aVals);
      const meanB = mean(bVals);
      const sdA = stddev(aVals);
      const sdB = stddev(bVals);
      const standardized = records.map((r) => ({
        a: (r.a - meanA) / sdA,
        b: (r.b - meanB) / sdB,
      }));

      const built = AnalyticsService.cluster({
        records,
        columns: [...cols],
        k: 2,
        standardize: true,
        seed: 7,
      });
      const manual = AnalyticsService.cluster({
        records: standardized,
        columns: [...cols],
        k: 2,
        seed: 7,
      });

      // Cluster *labels* are not stable, but the partition is. Compare by
      // mapping each cluster id to the canonical id of its first member.
      const canonical = (clusters: number[]): number[] => {
        const map = new Map<number, number>();
        let next = 0;
        return clusters.map((c) => {
          if (!map.has(c)) map.set(c, next++);
          return map.get(c)!;
        });
      };
      expect(canonical(built.clusters)).toEqual(canonical(manual.clusters));
    });

    it("standardize: true returns centroids in original-data units", () => {
      const records = [
        { a: 0.1, b: 100 },
        { a: 0.2, b: 200 },
        { a: 0.15, b: 150 },
        { a: 0.8, b: 800 },
        { a: 0.9, b: 900 },
        { a: 0.85, b: 850 },
      ];
      const result = AnalyticsService.cluster({
        records,
        columns: ["a", "b"],
        k: 2,
        standardize: true,
        seed: 7,
      });
      // Each centroid's `b` component should land in the original [100, 900]
      // range, not in the [-2, 2] standardized range.
      for (const centroid of result.centroids) {
        expect(centroid[1]).toBeGreaterThan(50);
        expect(centroid[1]).toBeLessThan(1000);
      }
    });

    it("standardize: true survives a zero-stddev column", () => {
      const records = [
        { a: 1, c: 7 },
        { a: 2, c: 7 },
        { a: 3, c: 7 },
        { a: 10, c: 7 },
        { a: 11, c: 7 },
        { a: 12, c: 7 },
      ];
      const result = AnalyticsService.cluster({
        records,
        columns: ["a", "c"],
        k: 2,
        standardize: true,
        seed: 7,
      });
      // The constant column rounds back to the original mean (7) on un-standardize.
      for (const centroid of result.centroids) {
        expect(centroid[1]).toBeCloseTo(7, 9);
      }
    });

    it("maxIterations: 1 still returns valid result shape", () => {
      const records = [
        { a: 1, b: 1 },
        { a: 1.5, b: 2 },
        { a: 2, b: 1 },
        { a: 10, b: 10 },
        { a: 11, b: 10 },
        { a: 10, b: 11 },
      ];
      const result = AnalyticsService.cluster({
        records,
        columns: ["a", "b"],
        k: 2,
        maxIterations: 1,
      });
      expect(result.clusters).toHaveLength(6);
      expect(result.centroids).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // regression
  // -----------------------------------------------------------------------

  describe("regression()", () => {
    it("should compute linear regression with high R² for linear data", () => {
      const result = AnalyticsService.regression({
        records: NUMERIC_RECORDS,
        x: "x",
        y: "y",
        type: "linear",
      });

      // y ≈ 2x, so slope ≈ 2
      expect(result.coefficients).toHaveLength(2); // [intercept, slope]
      expect(result.coefficients[1]).toBeCloseTo(2.0, 0);
      expect(result.rSquared).toBeGreaterThan(0.99);
    });

    it("should compute polynomial regression", () => {
      // Create quadratic data: y = x² + noise
      const records = Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: i * i + (Math.random() - 0.5) * 2,
      }));

      const result = AnalyticsService.regression({
        records,
        x: "x",
        y: "y",
        type: "polynomial",
        degree: 2,
      });

      expect(result.coefficients).toHaveLength(3); // [a0, a1, a2]
      expect(result.rSquared).toBeGreaterThan(0.95);
      // a2 should be close to 1 (coefficient of x²)
      expect(result.coefficients[2]).toBeCloseTo(1, 0);
    });

    it("should throw for insufficient data", () => {
      expect(() =>
        AnalyticsService.regression({
          records: [{ x: 1, y: 2 }],
          x: "x",
          y: "y",
          type: "linear",
        })
      ).toThrow("at least 2 values");
    });

    it("linear-single returns the five new diagnostic fields", () => {
      const result = AnalyticsService.regression({
        records: NUMERIC_RECORDS,
        x: "x",
        y: "y",
        type: "linear",
      });

      expect(result.residuals).toHaveLength(NUMERIC_RECORDS.length);
      expect(result.standardErrors).toHaveLength(2);
      expect(result.tStatistics).toHaveLength(2);
      expect(result.pValues).toHaveLength(2);
      expect(result.confidenceIntervals.lower).toHaveLength(2);
      expect(result.confidenceIntervals.upper).toHaveLength(2);
      for (let i = 0; i < 2; i++) {
        expect(result.confidenceIntervals.lower[i]).toBeLessThanOrEqual(
          result.coefficients[i]
        );
        expect(result.coefficients[i]).toBeLessThanOrEqual(
          result.confidenceIntervals.upper[i]
        );
      }
    });

    it("linear-single produces non-trivial SEs and clear-signal t-stats", () => {
      // x=[1..10], slightly noisy y. Computed expected values from the
      // closed-form OLS formula on this fixture (verified by hand):
      //   slope ≈ 0.9776, intercept ≈ 1.2533, stderr_slope ≈ 0.0156,
      //   t_slope ≈ 62.7 (huge — strong linear signal).
      const records = [
        { x: 1, y: 2.5 },
        { x: 2, y: 3.1 },
        { x: 3, y: 4.0 },
        { x: 4, y: 5.2 },
        { x: 5, y: 6.1 },
        { x: 6, y: 7.0 },
        { x: 7, y: 8.1 },
        { x: 8, y: 9.2 },
        { x: 9, y: 10.0 },
        { x: 10, y: 11.1 },
      ];
      const result = AnalyticsService.regression({
        records,
        x: "x",
        y: "y",
        type: "linear",
      });
      expect(result.coefficients[0]).toBeCloseTo(1.2533, 3);
      expect(result.coefficients[1]).toBeCloseTo(0.9776, 3);
      expect(result.standardErrors[1]).toBeGreaterThan(0);
      expect(result.standardErrors[1]).toBeLessThan(0.05);
      // Clear linear signal — slope t-stat should dominate
      expect(Math.abs(result.tStatistics[1])).toBeGreaterThan(50);
      expect(result.pValues[1]).toBeLessThan(1e-9);
    });

    it("multivariate fit on xColumns: [a, b] returns 3 coefficients with high R²", () => {
      // y = 2 + 3a + 4b + small noise
      const records = Array.from({ length: 20 }, (_, i) => {
        const a = i % 5;
        const b = Math.floor(i / 5);
        const noise = ((i % 3) - 1) * 0.05;
        return { a, b, y: 2 + 3 * a + 4 * b + noise };
      });
      const result = AnalyticsService.regression({
        records,
        xColumns: ["a", "b"],
        y: "y",
        type: "linear",
      });
      expect(result.coefficients).toHaveLength(3);
      expect(result.coefficients[0]).toBeCloseTo(2, 1);
      expect(result.coefficients[1]).toBeCloseTo(3, 1);
      expect(result.coefficients[2]).toBeCloseTo(4, 1);
      expect(result.rSquared).toBeGreaterThan(0.99);
    });

    it("multivariate residuals sum to ≈ 0 (mean-zero by construction)", () => {
      const records = Array.from({ length: 20 }, (_, i) => {
        const a = i % 5;
        const b = Math.floor(i / 5);
        const noise = ((i % 3) - 1) * 0.05;
        return { a, b, y: 2 + 3 * a + 4 * b + noise };
      });
      const result = AnalyticsService.regression({
        records,
        xColumns: ["a", "b"],
        y: "y",
        type: "linear",
      });
      const sumResiduals = result.residuals.reduce((s, r) => s + r, 0);
      expect(Math.abs(sumResiduals)).toBeLessThan(1e-9);
    });

    it("multivariate p-values for real-signal slopes are tiny", () => {
      const records = Array.from({ length: 20 }, (_, i) => {
        const a = i % 5;
        const b = Math.floor(i / 5);
        const noise = ((i % 3) - 1) * 0.05;
        return { a, b, y: 2 + 3 * a + 4 * b + noise };
      });
      const result = AnalyticsService.regression({
        records,
        xColumns: ["a", "b"],
        y: "y",
        type: "linear",
      });
      expect(result.pValues[1]).toBeLessThan(0.001);
      expect(result.pValues[2]).toBeLessThan(0.001);
    });

    it("multivariate CIs span coefficients and respect the confidence level", () => {
      const records = Array.from({ length: 20 }, (_, i) => {
        const a = i % 5;
        const b = Math.floor(i / 5);
        const noise = ((i % 3) - 1) * 0.05;
        return { a, b, y: 2 + 3 * a + 4 * b + noise };
      });
      const ci95 = AnalyticsService.regression({
        records,
        xColumns: ["a", "b"],
        y: "y",
        type: "linear",
      });
      const ci99 = AnalyticsService.regression({
        records,
        xColumns: ["a", "b"],
        y: "y",
        type: "linear",
        confidence: 0.99,
      });

      // 0.99 CI must be wider than 0.95 CI for at least one slope coefficient.
      const width95 =
        ci95.confidenceIntervals.upper[1] - ci95.confidenceIntervals.lower[1];
      const width99 =
        ci99.confidenceIntervals.upper[1] - ci99.confidenceIntervals.lower[1];
      expect(width99).toBeGreaterThan(width95);

      // CIs span the point estimate
      for (let i = 0; i < 3; i++) {
        expect(ci95.confidenceIntervals.lower[i]).toBeLessThanOrEqual(
          ci95.coefficients[i]
        );
        expect(ci95.coefficients[i]).toBeLessThanOrEqual(
          ci95.confidenceIntervals.upper[i]
        );
      }
    });

    it("xColumns and x together is rejected", () => {
      expect(() =>
        AnalyticsService.regression({
          records: NUMERIC_RECORDS,
          x: "x",
          xColumns: ["x"],
          y: "y",
          type: "linear",
        })
      ).toThrow(/specify either x or xColumns, not both/);
    });

    it("xColumns with type 'polynomial' is rejected", () => {
      expect(() =>
        AnalyticsService.regression({
          records: NUMERIC_RECORDS,
          xColumns: ["x"],
          y: "y",
          type: "polynomial",
        })
      ).toThrow(/multivariate polynomial regression is not supported/);
    });

    it("polynomial degree 2 result includes the five diagnostic fields", () => {
      const records = Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: i * i + ((i % 3) - 1) * 0.1,
      }));
      const result = AnalyticsService.regression({
        records,
        x: "x",
        y: "y",
        type: "polynomial",
        degree: 2,
      });
      expect(result.coefficients).toHaveLength(3);
      expect(result.residuals).toHaveLength(20);
      expect(result.standardErrors).toHaveLength(3);
      expect(result.tStatistics).toHaveLength(3);
      expect(result.pValues).toHaveLength(3);
      expect(result.confidenceIntervals.lower).toHaveLength(3);
    });

    it("computes high-R² fit for cubic data with degree 3", () => {
      // y = x³ + small noise on x ∈ [-10, 10]
      const records = Array.from({ length: 21 }, (_, i) => {
        const x = i - 10;
        return { x, y: x ** 3 + (Math.random() - 0.5) * 2 };
      });

      const result = AnalyticsService.regression({
        records,
        x: "x",
        y: "y",
        type: "polynomial",
        degree: 3,
      });

      expect(result.coefficients).toHaveLength(4); // [a0, a1, a2, a3]
      expect(result.rSquared).toBeGreaterThan(0.99);
      // a3 should be close to 1 (coefficient of x³)
      expect(result.coefficients[3]).toBeCloseTo(1, 1);
    });
  });

  // -----------------------------------------------------------------------
  // logisticRegression
  // -----------------------------------------------------------------------

  describe("logisticRegression()", () => {
    const SEPARABLE_RECORDS = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 1 },
      { x: 6, y: 1 },
      { x: 7, y: 1 },
      { x: 8, y: 1 },
      { x: 9, y: 1 },
    ];

    it("reaches 100% accuracy on a well-separated single feature", () => {
      // On perfectly-separable data IRLS coefficients grow without bound,
      // so the relative-delta convergence check may not trigger and the
      // call hits maxIterations. Probabilities saturate correctly to 0/1
      // and accuracy is 100%. The model can read iterations === maxIterations
      // as a saturation signal.
      const result = AnalyticsService.logisticRegression({
        records: SEPARABLE_RECORDS,
        x: "x",
        y: "y",
      });
      expect(result.accuracy).toBe(1);
      for (let i = 0; i < SEPARABLE_RECORDS.length; i++) {
        const yi = SEPARABLE_RECORDS[i].y;
        if (yi === 0) {
          expect(result.probabilities[i]).toBeLessThan(0.5);
        } else {
          expect(result.probabilities[i]).toBeGreaterThanOrEqual(0.5);
        }
      }
    });

    it("multivariate logistic on a 2-feature linear separator", () => {
      const records = Array.from({ length: 20 }, (_, i) => {
        const a = i % 5;
        const b = Math.floor(i / 5);
        return { a, b, y: a + b > 5 ? 1 : 0 };
      });
      const result = AnalyticsService.logisticRegression({
        records,
        xColumns: ["a", "b"],
        y: "y",
      });
      expect(result.coefficients).toHaveLength(3);
      expect(result.accuracy).toBeGreaterThanOrEqual(0.95);
      expect(result.logLoss).toBeLessThan(0.5);
    });

    it("coefficient sign matches the feature direction", () => {
      const result = AnalyticsService.logisticRegression({
        records: SEPARABLE_RECORDS,
        x: "x",
        y: "y",
      });
      // Slope on x: y increases with x → positive slope
      expect(result.coefficients[1]).toBeGreaterThan(0);
    });

    it("log-loss matches a manual recomputation from probabilities", () => {
      const result = AnalyticsService.logisticRegression({
        records: SEPARABLE_RECORDS,
        x: "x",
        y: "y",
      });
      const n = SEPARABLE_RECORDS.length;
      let manual = 0;
      for (let i = 0; i < n; i++) {
        const yi = SEPARABLE_RECORDS[i].y;
        const p = Math.max(
          1e-15,
          Math.min(1 - 1e-15, result.probabilities[i])
        );
        manual += yi * Math.log(p) + (1 - yi) * Math.log(1 - p);
      }
      manual = -manual / n;
      expect(result.logLoss).toBeCloseTo(manual, 9);
    });

    it("all-positive y is rejected", () => {
      expect(() =>
        AnalyticsService.logisticRegression({
          records: [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 3, y: 1 },
            { x: 4, y: 1 },
            { x: 5, y: 1 },
          ],
          x: "x",
          y: "y",
        })
      ).toThrow(/at least one of each class/);
    });

    it("all-negative y is rejected", () => {
      expect(() =>
        AnalyticsService.logisticRegression({
          records: [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
            { x: 4, y: 0 },
            { x: 5, y: 0 },
          ],
          x: "x",
          y: "y",
        })
      ).toThrow(/at least one of each class/);
    });

    it("out-of-range y values are rejected", () => {
      expect(() =>
        AnalyticsService.logisticRegression({
          records: [
            { x: 1, y: 0 },
            { x: 2, y: 1 },
            { x: 3, y: 2 },
          ],
          x: "x",
          y: "y",
        })
      ).toThrow(/y values must be 0 or 1/);
    });

    it("boolean y values are coerced", () => {
      const records = [
        { x: 0, y: false },
        { x: 1, y: false },
        { x: 2, y: false },
        { x: 3, y: false },
        { x: 4, y: true },
        { x: 5, y: true },
        { x: 6, y: true },
        { x: 7, y: true },
      ];
      const result = AnalyticsService.logisticRegression({
        records,
        x: "x",
        y: "y",
      });
      expect(result.accuracy).toBeGreaterThanOrEqual(0.5);
    });

    it("maxIterations cap is honored", () => {
      const result = AnalyticsService.logisticRegression({
        records: SEPARABLE_RECORDS,
        x: "x",
        y: "y",
        maxIterations: 1,
      });
      expect(result.iterations).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // trend
  // -----------------------------------------------------------------------

  describe("trend()", () => {
    it("should aggregate by month and compute trend line", () => {
      const result = AnalyticsService.trend({
        records: TIMESERIES_RECORDS,
        dateColumn: "date",
        valueColumn: "revenue",
        interval: "month",
      });

      expect(result.dates).toHaveLength(3); // Jan, Feb, Mar
      expect(result.values).toHaveLength(3);
      expect(result.trendLine.slope).toBeGreaterThan(0); // upward trend
    });

    it("should return empty for empty records", () => {
      const result = AnalyticsService.trend({
        records: [],
        dateColumn: "date",
        valueColumn: "revenue",
        interval: "month",
      });

      expect(result.dates).toHaveLength(0);
      expect(result.values).toHaveLength(0);
    });

    it("forecast field is absent when forecastPeriods is omitted", () => {
      const result = AnalyticsService.trend({
        records: TIMESERIES_RECORDS,
        dateColumn: "date",
        valueColumn: "revenue",
        interval: "month",
      });
      expect("forecast" in result).toBe(false);
    });

    it("forecastPeriods: 3 projects three values along the linear fit", () => {
      const result = AnalyticsService.trend({
        records: TIMESERIES_RECORDS,
        dateColumn: "date",
        valueColumn: "revenue",
        interval: "month",
        forecastPeriods: 3,
      });
      expect(result.forecast).toBeDefined();
      expect(result.forecast!.values).toHaveLength(3);
      expect(result.forecast!.dates).toHaveLength(3);
      // Each successive forecast value differs by `slope`
      for (let i = 1; i < 3; i++) {
        const delta =
          result.forecast!.values[i] - result.forecast!.values[i - 1];
        expect(delta).toBeCloseTo(result.trendLine.slope, 9);
      }
    });
  });

  // -----------------------------------------------------------------------
  // forecast (Holt-Winters)
  // -----------------------------------------------------------------------

  describe("forecast()", () => {
    it("Holt's linear (no seasonality) extends a clean trend", () => {
      // y_i = 10 + 2i, i ∈ [0, 19]
      const records = Array.from({ length: 20 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 10 + 2 * i,
      }));
      const result = AnalyticsService.forecast({
        records,
        dateColumn: "date",
        valueColumn: "value",
        horizon: 5,
        trend: "additive",
      });
      // First forecast should be near y_20 = 50
      expect(Math.abs(result.forecast.values[0] - 50)).toBeLessThan(2);
    });

    it("additive seasonality recovers the seasonal pattern", () => {
      // y_i = 100 + 10·sin(2π·i/12), 48 monthly observations, no trend
      const records = Array.from({ length: 48 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 100 + 10 * Math.sin((2 * Math.PI * i) / 12),
      }));
      const result = AnalyticsService.forecast({
        records,
        dateColumn: "date",
        valueColumn: "value",
        horizon: 12,
        seasonalPeriod: 12,
        seasonality: "additive",
        trend: "none",
      });
      // i = 48 → sin(2π·48/12) = sin(8π) = 0 → y ≈ 100
      expect(Math.abs(result.forecast.values[0] - 100)).toBeLessThan(2);
    });

    it("MAPE is small for a clean signal", () => {
      const records = Array.from({ length: 48 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 100 + 10 * Math.sin((2 * Math.PI * i) / 12),
      }));
      const result = AnalyticsService.forecast({
        records,
        dateColumn: "date",
        valueColumn: "value",
        horizon: 12,
        seasonalPeriod: 12,
        seasonality: "additive",
        trend: "none",
      });
      expect(result.mape).toBeLessThan(5);
    });

    it("prediction intervals widen monotonically with horizon", () => {
      const records = Array.from({ length: 48 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 100 + 10 * Math.sin((2 * Math.PI * i) / 12),
      }));
      const result = AnalyticsService.forecast({
        records,
        dateColumn: "date",
        valueColumn: "value",
        horizon: 12,
        seasonalPeriod: 12,
        seasonality: "additive",
        trend: "none",
      });
      const widths = result.forecast.upper.map(
        (u, i) => u - result.forecast.lower[i]
      );
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
      }
    });

    it("multiplicative seasonality requires positive observations", () => {
      const records = Array.from({ length: 48 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: i < 24 ? -1 : 1,
      }));
      expect(() =>
        AnalyticsService.forecast({
          records,
          dateColumn: "date",
          valueColumn: "value",
          horizon: 12,
          seasonalPeriod: 12,
          seasonality: "multiplicative",
        })
      ).toThrow(/multiplicative seasonality requires positive/);
    });

    it("rejects series shorter than 2 full seasons for seasonal models", () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        value: i,
      }));
      expect(() =>
        AnalyticsService.forecast({
          records,
          dateColumn: "date",
          valueColumn: "value",
          horizon: 5,
          seasonalPeriod: 8,
          seasonality: "additive",
        })
      ).toThrow(/at least 2 full seasons/);
    });

    it("returns the smoothing parameters used", () => {
      const records = Array.from({ length: 20 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 10 + 2 * i,
      }));
      const result = AnalyticsService.forecast({
        records,
        dateColumn: "date",
        valueColumn: "value",
        horizon: 3,
        alpha: 0.7,
        beta: 0.2,
        gamma: 0.3,
      });
      expect(result.parameters).toEqual({ alpha: 0.7, beta: 0.2, gamma: 0.3 });
    });

    it("default smoothing parameters are 0.5 / 0.1 / 0.1", () => {
      const records = Array.from({ length: 20 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 10 + 2 * i,
      }));
      const result = AnalyticsService.forecast({
        records,
        dateColumn: "date",
        valueColumn: "value",
        horizon: 3,
      });
      expect(result.parameters).toEqual({ alpha: 0.5, beta: 0.1, gamma: 0.1 });
    });
  });

  // -----------------------------------------------------------------------
  // forecastFromStream (#129 streaming fold) — must equal forecast()
  // -----------------------------------------------------------------------

  describe("forecastFromStream()", () => {
    type Rec = Record<string, unknown>;

    // Yield records in fixed-size batches, mimicking the cursor's paging.
    async function* asStream(records: Rec[], batchSize: number) {
      for (let i = 0; i < records.length; i += batchSize) {
        yield records.slice(i, i + batchSize);
      }
    }

    const expectAllClose = (a: number[], b: number[], digits = 8) => {
      expect(a).toHaveLength(b.length);
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
    };

    // Assert the online fold reproduces the whole-array agent-facing payload.
    const expectMatchesWholeArray = async (
      records: Rec[],
      params: Parameters<typeof AnalyticsService.forecast>[0],
      batchSize = 7
    ) => {
      const whole = AnalyticsService.forecast({ ...params, records });
      const streamed = await AnalyticsService.forecastFromStream(
        asStream(records, batchSize),
        params
      );
      expectAllClose(streamed.forecast.values, whole.forecast.values);
      expectAllClose(streamed.forecast.lower, whole.forecast.lower);
      expectAllClose(streamed.forecast.upper, whole.forecast.upper);
      expect(streamed.forecast.dates).toEqual(whole.forecast.dates);
      expect(streamed.parameters).toEqual(whole.parameters);
      expect(streamed.mape).toBeCloseTo(whole.mape, 8);
      return streamed;
    };

    const trendSeries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 10 + 2 * i,
      }));

    const additiveSeasonalSeries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 100 + 10 * Math.sin((2 * Math.PI * i) / 12),
      }));

    const multiplicativeSeasonalSeries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 100 * (1 + 0.2 * Math.sin((2 * Math.PI * i) / 12)) * (1 + i / 100),
      }));

    it("matches whole-array forecast for Holt's linear (no seasonality)", async () => {
      await expectMatchesWholeArray(trendSeries(20), {
        records: [],
        dateColumn: "date",
        valueColumn: "value",
        horizon: 5,
        trend: "additive",
      });
    });

    it("matches whole-array forecast for additive seasonality", async () => {
      await expectMatchesWholeArray(additiveSeasonalSeries(48), {
        records: [],
        dateColumn: "date",
        valueColumn: "value",
        horizon: 12,
        seasonalPeriod: 12,
        seasonality: "additive",
        trend: "none",
      });
    });

    it("matches whole-array forecast for multiplicative seasonality + trend", async () => {
      await expectMatchesWholeArray(multiplicativeSeasonalSeries(48), {
        records: [],
        dateColumn: "date",
        valueColumn: "value",
        horizon: 12,
        seasonalPeriod: 12,
        seasonality: "multiplicative",
        trend: "additive",
      });
    });

    it("matches whole-array forecast with custom smoothing parameters", async () => {
      await expectMatchesWholeArray(additiveSeasonalSeries(48), {
        records: [],
        dateColumn: "date",
        valueColumn: "value",
        horizon: 6,
        seasonalPeriod: 12,
        seasonality: "additive",
        trend: "additive",
        alpha: 0.7,
        beta: 0.2,
        gamma: 0.3,
        confidence: 0.9,
      });
    });

    it("is invariant to batch boundaries (chunk size doesn't change the result)", async () => {
      const records = additiveSeasonalSeries(48);
      const params = {
        records: [] as Rec[],
        dateColumn: "date",
        valueColumn: "value",
        horizon: 8,
        seasonalPeriod: 12,
        seasonality: "additive" as const,
        trend: "none" as const,
      };
      const r1 = await AnalyticsService.forecastFromStream(
        asStream(records, 1),
        params
      );
      const r5 = await AnalyticsService.forecastFromStream(
        asStream(records, 5),
        params
      );
      const rAll = await AnalyticsService.forecastFromStream(
        asStream(records, records.length),
        params
      );
      expect(r1.forecast.values).toEqual(r5.forecast.values);
      expect(r5.forecast.values).toEqual(rAll.forecast.values);
      expect(r1.mape).toEqual(rAll.mape);
    });

    it("skips non-numeric rows yet derives spacing from the last record's date", async () => {
      // 20-point trend, then a trailing row whose VALUE is non-numeric but
      // whose DATE jumps far ahead. extractNumericColumn drops the value, so
      // both paths fold the same 20 observations — but forecast-date spacing
      // is taken from the last two *records*, so the jump must be honored.
      const records: Rec[] = [
        ...trendSeries(20),
        { date: "2030-01-01T00:00:00.000Z", value: "n/a" },
      ];
      const streamed = await expectMatchesWholeArray(
        records,
        {
          records: [],
          dateColumn: "date",
          valueColumn: "value",
          horizon: 4,
          trend: "additive",
        },
        6
      );
      // 20 valid observations folded (the non-numeric row excluded).
      expect(streamed.count).toBe(20);
    });

    it("returns the reduced shape — no full-length series arrays", async () => {
      const streamed = await AnalyticsService.forecastFromStream(
        asStream(trendSeries(20), 7),
        {
          dateColumn: "date",
          valueColumn: "value",
          horizon: 3,
          trend: "additive",
        }
      );
      expect(streamed).not.toHaveProperty("observed");
      expect(streamed).not.toHaveProperty("fitted");
      expect(streamed).not.toHaveProperty("dates");
      expect(streamed.forecast.values).toHaveLength(3);
      expect(streamed.count).toBe(20);
    });

    it("rejects multiplicative seasonality with a non-positive observation", async () => {
      const records = Array.from({ length: 48 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: i === 30 ? -1 : 100,
      }));
      await expect(
        AnalyticsService.forecastFromStream(asStream(records, 7), {
          dateColumn: "date",
          valueColumn: "value",
          horizon: 12,
          seasonalPeriod: 12,
          seasonality: "multiplicative",
        })
      ).rejects.toThrow(/multiplicative seasonality requires positive/);
    });

    it("rejects a series shorter than 2 full seasons (matches forecast)", async () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        value: i,
      }));
      await expect(
        AnalyticsService.forecastFromStream(asStream(records, 3), {
          dateColumn: "date",
          valueColumn: "value",
          horizon: 5,
          seasonalPeriod: 8,
          seasonality: "additive",
        })
      ).rejects.toThrow(/at least 2 full seasons/);
    });

    it("rejects a non-seasonal series shorter than 4 observations", async () => {
      const records = trendSeries(3);
      await expect(
        AnalyticsService.forecastFromStream(asStream(records, 2), {
          dateColumn: "date",
          valueColumn: "value",
          horizon: 2,
        })
      ).rejects.toThrow(/at least 4 observations/);
    });
  });

  // -----------------------------------------------------------------------
  // decompose
  // -----------------------------------------------------------------------

  describe("decompose()", () => {
    /** y = 50 + i + 5·sin(2π·i/12), 48 monthly observations. */
    const cleanSeasonalSeries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        // Distinct timestamps (one per row) so the date sort is stable.
        value: 50 + i + 5 * Math.sin((2 * Math.PI * i) / 12),
      }));

    it("additive decomposition recovers the seasonal pattern on a clean signal", () => {
      const records = cleanSeasonalSeries(48);
      const result = AnalyticsService.decompose({
        records,
        dateColumn: "date",
        valueColumn: "value",
        seasonalPeriod: 12,
      });
      // seasonal component should be non-trivial at peaks/troughs
      // and sum to ≈ 0 over one cycle
      const cycleSum = result.seasonal
        .slice(0, 12)
        .reduce((s, v) => s + v, 0);
      expect(Math.abs(cycleSum)).toBeLessThan(1e-9);
      // sin(2π·0/12) = 0; check seasonal[0] is small
      expect(Math.abs(result.seasonal[0])).toBeLessThan(0.5);
    });

    it("trend recovers the linear component away from edges", () => {
      const records = cleanSeasonalSeries(48);
      const result = AnalyticsService.decompose({
        records,
        dateColumn: "date",
        valueColumn: "value",
        seasonalPeriod: 12,
      });
      // mid-series: trend[24] ≈ 50 + 24 = 74
      expect(result.trend[24]).not.toBeNull();
      expect(result.trend[24]!).toBeCloseTo(74, 0);
    });

    it("edge values of trend and residual are null", () => {
      const records = cleanSeasonalSeries(48);
      const result = AnalyticsService.decompose({
        records,
        dateColumn: "date",
        valueColumn: "value",
        seasonalPeriod: 12,
      });
      // First and last 6 (= m/2) entries of trend are null for even m
      for (let i = 0; i < 6; i++) {
        expect(result.trend[i]).toBeNull();
        expect(result.trend[result.trend.length - 1 - i]).toBeNull();
        expect(result.residual[i]).toBeNull();
        expect(result.residual[result.residual.length - 1 - i]).toBeNull();
      }
    });

    it("multiplicative decomposition seasonal centers around 1", () => {
      const records = Array.from({ length: 48 }, (_, i) => ({
        date: `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        value: 100 * (1 + 0.1 * Math.sin((2 * Math.PI * i) / 12)),
      }));
      const result = AnalyticsService.decompose({
        records,
        dateColumn: "date",
        valueColumn: "value",
        seasonalPeriod: 12,
        seasonality: "multiplicative",
      });
      const cycleMean =
        result.seasonal.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
      expect(cycleMean).toBeCloseTo(1, 2);
    });

    it("multiplicative decomposition rejects non-positive observations", () => {
      const records = [
        { date: "2024-01-01", value: 1 },
        { date: "2024-01-02", value: 2 },
        { date: "2024-01-03", value: 0 }, // not positive
        { date: "2024-01-04", value: 3 },
      ];
      expect(() =>
        AnalyticsService.decompose({
          records,
          dateColumn: "date",
          valueColumn: "value",
          seasonalPeriod: 2,
          seasonality: "multiplicative",
        })
      ).toThrow(/multiplicative .* positive/);
    });

    it("rejects series shorter than 2 full seasons", () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        value: i,
      }));
      expect(() =>
        AnalyticsService.decompose({
          records,
          dateColumn: "date",
          valueColumn: "value",
          seasonalPeriod: 12,
        })
      ).toThrow(/at least 2 full seasons/);
    });
  });

  // -----------------------------------------------------------------------
  // changepoint
  // -----------------------------------------------------------------------

  describe("changepoint()", () => {
    it("detects a single mean shift at the obvious break", () => {
      // 100 rows: first 50 around mean 0, last 50 around mean 5;
      // alternating ±0.3 perturbation for reproducibility.
      const records = Array.from({ length: 100 }, (_, i) => ({
        date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
        value:
          (i < 50 ? 0 : 5) + (i % 2 === 0 ? 0.3 : -0.3),
      }));
      const result = AnalyticsService.changepoint({
        records,
        valueColumn: "value",
      });
      expect(result.changepoints.length).toBe(1);
      expect(Math.abs(result.changepoints[0] - 50)).toBeLessThan(5);
    });

    it("detects multiple mean shifts in a three-regime fixture", () => {
      // 150 rows: 0..49 mean 0, 50..99 mean 5, 100..149 mean 10
      const records = Array.from({ length: 150 }, (_, i) => ({
        date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-01`,
        value:
          (i < 50 ? 0 : i < 100 ? 5 : 10) + (i % 2 === 0 ? 0.3 : -0.3),
      }));
      const result = AnalyticsService.changepoint({
        records,
        valueColumn: "value",
      });
      expect(result.changepoints.length).toBe(2);
      expect(Math.abs(result.changepoints[0] - 50)).toBeLessThan(10);
      expect(Math.abs(result.changepoints[1] - 100)).toBeLessThan(10);
    });

    it("constant series returns zero changepoints", () => {
      const records = Array.from({ length: 30 }, (_, i) => ({
        date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
        value: 7,
      }));
      const result = AnalyticsService.changepoint({
        records,
        valueColumn: "value",
      });
      expect(result.changepoints).toHaveLength(0);
      expect(result.segmentMeans).toEqual([7]);
    });

    it("segmentMeans and segments lengths align with changepoints + 1", () => {
      const records = Array.from({ length: 100 }, (_, i) => ({
        value: (i < 50 ? 0 : 5) + (i % 2 === 0 ? 0.3 : -0.3),
      }));
      const result = AnalyticsService.changepoint({
        records,
        valueColumn: "value",
      });
      expect(result.segmentMeans.length).toBe(result.changepoints.length + 1);
      expect(result.segments.length).toBe(result.changepoints.length + 1);
    });

    it("changepointDates is present iff dateColumn is supplied", () => {
      const records = Array.from({ length: 100 }, (_, i) => ({
        date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
        value: (i < 50 ? 0 : 5) + (i % 2 === 0 ? 0.3 : -0.3),
      }));
      const withDate = AnalyticsService.changepoint({
        records,
        dateColumn: "date",
        valueColumn: "value",
      });
      const withoutDate = AnalyticsService.changepoint({
        records,
        valueColumn: "value",
      });
      expect(withDate.changepointDates).toBeDefined();
      expect(withDate.changepointDates!.length).toBe(
        withDate.changepoints.length
      );
      expect("changepointDates" in withoutDate).toBe(false);
    });

    it("lower threshold flags more shifts on noisy data", () => {
      // Two regimes with mild gap (mean 0 → 1.5)
      const records = Array.from({ length: 100 }, (_, i) => ({
        value:
          (i < 50 ? 0 : 1.5) + (i % 2 === 0 ? 0.4 : -0.4),
      }));
      const strict = AnalyticsService.changepoint({
        records,
        valueColumn: "value",
        threshold: 5,
      });
      const loose = AnalyticsService.changepoint({
        records,
        valueColumn: "value",
        threshold: 2,
      });
      expect(loose.changepoints.length).toBeGreaterThanOrEqual(
        strict.changepoints.length
      );
    });
  });

  // -----------------------------------------------------------------------
  // hypothesisTest
  // -----------------------------------------------------------------------

  describe("hypothesisTest()", () => {
    it("t_test_one_sample returns p ≈ 0 when sample mean is far from μ₀", () => {
      // n = 100 with mean ≈ 5; testing against μ = 0 should reject hard.
      const records = Array.from({ length: 100 }, (_, i) => ({
        x: 5 + (i % 5) * 0.01,
      }));
      const result = AnalyticsService.hypothesisTest({
        test: "t_test_one_sample",
        records,
        columnA: "x",
        mu: 0,
      });
      expect(result.pValue).toBeLessThan(1e-6);
      expect(result.df).toBe(99);
    });

    it("t_test_one_sample returns p ≈ 1 when sample mean ≈ μ₀", () => {
      // Symmetric data around 0 → t ≈ 0, p ≈ 1.
      const records = [-2, -1, 0, 1, 2].map((x) => ({ x }));
      const result = AnalyticsService.hypothesisTest({
        test: "t_test_one_sample",
        records,
        columnA: "x",
        mu: 0,
      });
      expect(result.statistic).toBeCloseTo(0, 9);
      expect(result.pValue).toBeCloseTo(1, 9);
      expect(result.df).toBe(4);
    });

    it("t_test_one_sample matches scipy on a [1..10] reference fixture", () => {
      // scipy.stats.ttest_1samp([1..10], 0): t ≈ 5.7446, p ≈ 0.000277, df = 9
      const records = Array.from({ length: 10 }, (_, i) => ({ x: i + 1 }));
      const result = AnalyticsService.hypothesisTest({
        test: "t_test_one_sample",
        records,
        columnA: "x",
        mu: 0,
      });
      expect(result.statistic).toBeCloseTo(5.7446, 3);
      expect(result.pValue).toBeCloseTo(0.000277, 4);
      expect(result.df).toBe(9);
    });

    it("t_test_two_sample returns small p when groups differ", () => {
      // a = [1..10], b = [5..14] — same shape, shifted by 4
      const records = Array.from({ length: 10 }, (_, i) => ({
        a: i + 1,
        b: i + 5,
      }));
      const result = AnalyticsService.hypothesisTest({
        test: "t_test_two_sample",
        records,
        columnA: "a",
        columnB: "b",
      });
      expect(result.pValue).toBeLessThan(0.05);
    });

    it("t_test_two_sample returns large p when groups are identical", () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        a: i + 1,
        b: i + 1,
      }));
      const result = AnalyticsService.hypothesisTest({
        test: "t_test_two_sample",
        records,
        columnA: "a",
        columnB: "b",
      });
      expect(result.statistic).toBeCloseTo(0, 9);
      expect(result.pValue).toBeGreaterThan(0.5);
    });

    it("t_test_paired returns small p for a uniform shift", () => {
      const records = [
        { a: 5, b: 6 },
        { a: 6, b: 7 },
        { a: 7, b: 8 },
        { a: 8, b: 9 },
        { a: 9, b: 10 },
      ];
      const result = AnalyticsService.hypothesisTest({
        test: "t_test_paired",
        records,
        columnA: "a",
        columnB: "b",
      });
      expect(Math.abs(result.statistic)).toBeGreaterThan(1);
      expect(result.pValue).toBeLessThan(0.001);
      expect(result.df).toBe(4);
    });

    it("t_test_paired errors on length mismatch", () => {
      // Build records where columnA has more numeric values than columnB.
      const records = [
        { a: 1, b: 2 },
        { a: 2, b: 3 },
        { a: 3 }, // b missing — extracted column will be shorter
      ] as Record<string, unknown>[];
      expect(() =>
        AnalyticsService.hypothesisTest({
          test: "t_test_paired",
          records,
          columnA: "a",
          columnB: "b",
        })
      ).toThrow(/columns must be same length/);
    });

    it("mann_whitney returns small p when distributions differ wildly", () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        a: i + 1,
        b: i + 100,
      }));
      const result = AnalyticsService.hypothesisTest({
        test: "mann_whitney",
        records,
        columnA: "a",
        columnB: "b",
      });
      expect(result.pValue).toBeLessThan(0.001);
      expect(result.df).toBeUndefined();
    });

    it("mann_whitney returns a non-significant p when distributions are equal", () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        a: i + 1,
        b: i + 1,
      }));
      const result = AnalyticsService.hypothesisTest({
        test: "mann_whitney",
        records,
        columnA: "a",
        columnB: "b",
      });
      // Fully-tied samples + simple-statistics' tie-handling quirk shift the
      // rank sum off its theoretical mean, so |z| is non-zero. The p-value
      // is well above the standard significance thresholds, which is what
      // the test really asserts. Tool description warns about heavy-tie
      // accuracy degradation.
      expect(result.pValue).toBeGreaterThan(0.5);
    });

    it("chi_squared on a textbook fixture returns the expected statistic", () => {
      // observed=[10,20,30,40], expected=[25,25,25,25]
      // χ² = (15²+5²+5²+15²)/25 = 500/25 = 20; df=3; p < 1e-3
      const result = AnalyticsService.hypothesisTest({
        test: "chi_squared",
        observed: [10, 20, 30, 40],
        expected: [25, 25, 25, 25],
      });
      expect(result.statistic).toBeCloseTo(20, 9);
      expect(result.df).toBe(3);
      expect(result.pValue).toBeLessThan(1e-3);
    });

    it("chi_squared with observed === expected gives p ≈ 1", () => {
      const result = AnalyticsService.hypothesisTest({
        test: "chi_squared",
        observed: [25, 25, 25, 25],
        expected: [25, 25, 25, 25],
      });
      expect(result.statistic).toBe(0);
      expect(result.pValue).toBeCloseTo(1, 9);
    });

    it("chi_squared honors a custom df override", () => {
      const result = AnalyticsService.hypothesisTest({
        test: "chi_squared",
        observed: [10, 20, 30, 40],
        expected: [25, 25, 25, 25],
        df: 2,
      });
      expect(result.df).toBe(2);
    });

    it("missing required input throws an error naming the test and field", () => {
      expect(() =>
        AnalyticsService.hypothesisTest({
          test: "t_test_two_sample",
          records: [{ a: 1, b: 2 }],
          columnA: "a",
          // columnB omitted
        })
      ).toThrow(/Missing input for test="t_test_two_sample".*columnB/);
    });
  });

  // -----------------------------------------------------------------------
  // aggregate
  // -----------------------------------------------------------------------

  describe("aggregate()", () => {
    const SALES_RECORDS = [
      { region: "A", quarter: "Q1", revenue: 100 },
      { region: "A", quarter: "Q1", revenue: 200 },
      { region: "A", quarter: "Q2", revenue: 300 },
      { region: "B", quarter: "Q1", revenue: 150 },
      { region: "B", quarter: "Q2", revenue: 250 },
    ];

    it("groups by a single column and sums", () => {
      const result = AnalyticsService.aggregate({
        records: SALES_RECORDS,
        groupBy: ["region"],
        metrics: [{ op: "sum", column: "revenue" }],
      });
      expect(result.rows).toHaveLength(2);
      const a = result.rows.find((r) => r.region === "A")!;
      const b = result.rows.find((r) => r.region === "B")!;
      expect(a.sum_revenue).toBe(600);
      expect(b.sum_revenue).toBe(400);
    });

    it("aggregates over the whole table when groupBy is empty", () => {
      const result = AnalyticsService.aggregate({
        records: SALES_RECORDS,
        groupBy: [],
        metrics: [{ op: "sum", column: "revenue" }],
      });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].sum_revenue).toBe(1000);
    });

    it("count metric works without a column", () => {
      const result = AnalyticsService.aggregate({
        records: SALES_RECORDS,
        groupBy: ["region"],
        metrics: [{ op: "count" }],
      });
      const a = result.rows.find((r) => r.region === "A")!;
      const b = result.rows.find((r) => r.region === "B")!;
      expect(a.count).toBe(3);
      expect(b.count).toBe(2);
    });

    it("supports multiple metrics in one call", () => {
      const result = AnalyticsService.aggregate({
        records: SALES_RECORDS,
        groupBy: ["region"],
        metrics: [
          { op: "sum", column: "revenue" },
          { op: "mean", column: "revenue" },
          { op: "count" },
        ],
      });
      const a = result.rows.find((r) => r.region === "A")!;
      expect(a.sum_revenue).toBe(600);
      expect(a.mean_revenue).toBe(200);
      expect(a.count).toBe(3);
    });

    it("honors custom aliases via `as`", () => {
      const result = AnalyticsService.aggregate({
        records: SALES_RECORDS,
        groupBy: ["region"],
        metrics: [
          { op: "sum", column: "revenue", as: "total_rev" },
        ],
      });
      const a = result.rows.find((r) => r.region === "A")!;
      expect(a.total_rev).toBe(600);
      expect("sum_revenue" in a).toBe(false);
    });

    it("stddev uses the sample (n-1) divisor (Arquero default)", () => {
      const records = [
        { x: 1 },
        { x: 2 },
        { x: 3 },
        { x: 4 },
        { x: 5 },
      ];
      const result = AnalyticsService.aggregate({
        records,
        groupBy: [],
        metrics: [{ op: "stddev", column: "x" }],
      });
      // Sample variance of [1..5] = 10/4 = 2.5; stddev = √2.5
      expect(result.rows[0].stddev_x as number).toBeCloseTo(Math.sqrt(2.5), 9);
    });

    it("p25 and p75 work over groups", () => {
      const records = [
        { region: "A", x: 1 },
        { region: "A", x: 2 },
        { region: "A", x: 3 },
        { region: "A", x: 4 },
        { region: "A", x: 5 },
        { region: "B", x: 10 },
        { region: "B", x: 20 },
        { region: "B", x: 30 },
        { region: "B", x: 40 },
        { region: "B", x: 50 },
      ];
      const result = AnalyticsService.aggregate({
        records,
        groupBy: ["region"],
        metrics: [
          { op: "p25", column: "x" },
          { op: "p75", column: "x" },
        ],
      });
      const a = result.rows.find((r) => r.region === "A")!;
      const b = result.rows.find((r) => r.region === "B")!;
      expect(typeof a.p25_x).toBe("number");
      expect(typeof a.p75_x).toBe("number");
      // p25 < p75 within each group
      expect(a.p25_x as number).toBeLessThan(a.p75_x as number);
      expect(b.p25_x as number).toBeLessThan(b.p75_x as number);
      // B's quartiles dominate A's
      expect(b.p25_x as number).toBeGreaterThan(a.p75_x as number);
    });

    it("non-count op without column throws", () => {
      expect(() =>
        AnalyticsService.aggregate({
          records: SALES_RECORDS,
          groupBy: ["region"],
          metrics: [{ op: "sum" }],
        })
      ).toThrow(/op "sum" requires a column/);
    });

    it("multi-column groupBy keys output rows by all fields", () => {
      const result = AnalyticsService.aggregate({
        records: SALES_RECORDS,
        groupBy: ["region", "quarter"],
        metrics: [{ op: "sum", column: "revenue" }],
      });
      expect(result.rows).toHaveLength(4);
      const aQ1 = result.rows.find(
        (r) => r.region === "A" && r.quarter === "Q1"
      )!;
      expect(aQ1.sum_revenue).toBe(300); // 100 + 200
    });
  });

  // -----------------------------------------------------------------------
  // technicalIndicator
  // -----------------------------------------------------------------------

  describe("technicalIndicator()", () => {
    it("should compute SMA", () => {
      const result = AnalyticsService.technicalIndicator({
        records: NUMERIC_RECORDS,
        dateColumn: "date",
        valueColumn: "val",
        indicator: "SMA",
        params: { period: 5 },
      });

      expect(result.values.length).toBeGreaterThan(0);
      expect(result.dates.length).toBe(result.values.length);
      // SMA of first 5 values: (100+105+102+110+108)/5 = 105
      expect(result.values[0]).toBe(105);
    });

    it("should compute EMA", () => {
      const result = AnalyticsService.technicalIndicator({
        records: NUMERIC_RECORDS,
        dateColumn: "date",
        valueColumn: "val",
        indicator: "EMA",
        params: { period: 5 },
      });

      expect(result.values.length).toBeGreaterThan(0);
      expect(result.dates.length).toBe(result.values.length);
    });

    it("should compute RSI", () => {
      const result = AnalyticsService.technicalIndicator({
        records: NUMERIC_RECORDS,
        dateColumn: "date",
        valueColumn: "val",
        indicator: "RSI",
        params: { period: 5 },
      });

      expect(result.values.length).toBeGreaterThan(0);
      // RSI is between 0 and 100
      for (const v of result.values) {
        expect(v as number).toBeGreaterThanOrEqual(0);
        expect(v as number).toBeLessThanOrEqual(100);
      }
    });

    it("should compute MACD", () => {
      // Need more data for MACD
      const records = Array.from({ length: 30 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        val: 100 + i * 2 + Math.sin(i) * 5,
      }));

      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "val",
        indicator: "MACD",
      });

      expect(result.values.length).toBeGreaterThan(0);
    });

    it("should throw for unsupported indicator", () => {
      expect(() =>
        AnalyticsService.technicalIndicator({
          records: NUMERIC_RECORDS,
          dateColumn: "date",
          valueColumn: "val",
          // @ts-expect-error testing unsupported indicator
          indicator: "INVALID",
        })
      ).toThrow("Unsupported indicator");
    });

    // Deterministic synthetic OHLCV fixture for the new indicators.
    const makeOHLCV = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const close = 100 + Math.sin(i / 3) * 5 + i * 0.1;
        return {
          date: `2024-01-${String(i + 1).padStart(2, "0")}`,
          high: close + 1,
          low: close - 1,
          close,
          open: close - 0.5,
          volume: 1000 + i * 10,
        };
      });

    it("Stochastic returns objects with k always numeric and d numeric after the signal warmup", () => {
      const records = makeOHLCV(30);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Stochastic",
      });
      expect(result.values.length).toBeGreaterThan(0);
      expect(result.dates.length).toBe(result.values.length);
      // `k` is present on every output row; `d` is the signal SMA of `k`
      // and is undefined during its warmup window.
      for (const v of result.values) {
        const obj = v as { k: number; d: number | undefined };
        expect(typeof obj.k).toBe("number");
      }
      const withSignal = result.values.filter(
        (v) => typeof (v as { d?: number }).d === "number"
      );
      expect(withSignal.length).toBeGreaterThan(0);
    });

    it("ADX returns objects with adx, pdi, mdi numeric fields", () => {
      const records = makeOHLCV(30);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "ADX",
      });
      expect(result.values.length).toBeGreaterThan(0);
      for (const v of result.values) {
        const obj = v as { adx: number; pdi: number; mdi: number };
        expect(typeof obj.adx).toBe("number");
        expect(typeof obj.pdi).toBe("number");
        expect(typeof obj.mdi).toBe("number");
      }
    });

    it("VWAP returns numeric values aligned 1:1 with input rows", () => {
      const records = makeOHLCV(30);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "VWAP",
      });
      expect(result.values.length).toBe(records.length);
      expect(result.dates.length).toBe(records.length);
      for (const v of result.values) {
        expect(typeof v).toBe("number");
      }
    });

    it("WilliamsR returns numeric values in [-100, 0]", () => {
      const records = makeOHLCV(30);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "WilliamsR",
      });
      expect(result.values.length).toBeGreaterThan(0);
      for (const v of result.values) {
        const n = v as number;
        expect(n).toBeLessThanOrEqual(0);
        expect(n).toBeGreaterThanOrEqual(-100);
      }
    });

    it("CCI returns numeric values", () => {
      const records = makeOHLCV(30);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "CCI",
      });
      expect(result.values.length).toBeGreaterThan(0);
      for (const v of result.values) {
        expect(typeof v).toBe("number");
      }
    });

    it("ROC returns numeric values", () => {
      const records = makeOHLCV(30);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "ROC",
      });
      expect(result.values.length).toBeGreaterThan(0);
      for (const v of result.values) {
        expect(typeof v).toBe("number");
      }
    });

    it("PSAR returns numeric values one-per-input-row (offset 0)", () => {
      const records = makeOHLCV(30);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "PSAR",
      });
      expect(result.values.length).toBe(records.length);
      for (const v of result.values) {
        expect(typeof v).toBe("number");
      }
    });

    it("Ichimoku returns objects with conversion, base, spanA, spanB numeric fields", () => {
      const records = makeOHLCV(60);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Ichimoku",
      });
      expect(result.values.length).toBeGreaterThan(0);
      for (const v of result.values) {
        const obj = v as {
          conversion: number;
          base: number;
          spanA: number;
          spanB: number;
        };
        expect(typeof obj.conversion).toBe("number");
        expect(typeof obj.base).toBe("number");
        expect(typeof obj.spanA).toBe("number");
        expect(typeof obj.spanB).toBe("number");
      }
    });

    it("Donchian returns objects with upper, middle, lower numeric fields", () => {
      const records = makeOHLCV(30);
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Donchian",
        params: { period: 20 },
      });
      expect(result.values.length).toBeGreaterThan(0);
      expect(result.dates.length).toBe(result.values.length);
      for (const v of result.values) {
        const obj = v as { upper: number; middle: number; lower: number };
        expect(typeof obj.upper).toBe("number");
        expect(typeof obj.middle).toBe("number");
        expect(typeof obj.lower).toBe("number");
        expect(obj.upper).toBeGreaterThanOrEqual(obj.middle);
        expect(obj.middle).toBeGreaterThanOrEqual(obj.lower);
        expect(obj.middle).toBeCloseTo((obj.upper + obj.lower) / 2, 9);
      }
    });

    it("Donchian on a hand-computable fixture matches the rolling high/low", () => {
      // 5-row fixture, period 3:
      //   high = [10, 12, 11, 14, 13]
      //   low  = [ 5,  6,  4,  7,  6]
      // Window 1 (rows 0..2): upper=12, lower=4, middle=8
      // Window 2 (rows 1..3): upper=14, lower=4, middle=9
      // Window 3 (rows 2..4): upper=14, lower=4, middle=9
      const records = [
        { date: "2024-01-01", high: 10, low: 5, close: 7 },
        { date: "2024-01-02", high: 12, low: 6, close: 9 },
        { date: "2024-01-03", high: 11, low: 4, close: 8 },
        { date: "2024-01-04", high: 14, low: 7, close: 12 },
        { date: "2024-01-05", high: 13, low: 6, close: 10 },
      ];
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Donchian",
        params: { period: 3 },
      });
      expect(result.values).toHaveLength(3);
      expect(result.values[0]).toEqual({ upper: 12, middle: 8, lower: 4 });
      expect(result.values[1]).toEqual({ upper: 14, middle: 9, lower: 4 });
      expect(result.values[2]).toEqual({ upper: 14, middle: 9, lower: 4 });
    });

    it("Donchian aligns dates to the right edge of each window", () => {
      // Period 3 over 5 rows → 3 windows, dates align to the last row of each
      const records = [
        { date: "2024-01-01", high: 10, low: 5, close: 7 },
        { date: "2024-01-02", high: 12, low: 6, close: 9 },
        { date: "2024-01-03", high: 11, low: 4, close: 8 },
        { date: "2024-01-04", high: 14, low: 7, close: 12 },
        { date: "2024-01-05", high: 13, low: 6, close: 10 },
      ];
      const result = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Donchian",
        params: { period: 3 },
      });
      expect(result.dates).toEqual([
        "2024-01-03",
        "2024-01-04",
        "2024-01-05",
      ]);
    });

    it("Donchian default period is 20", () => {
      const records = makeOHLCV(30);
      const def = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Donchian",
      });
      const explicit = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Donchian",
        params: { period: 20 },
      });
      expect(def.values).toEqual(explicit.values);
      expect(def.dates).toEqual(explicit.dates);
    });

    it("custom params override the defaults", () => {
      const records = makeOHLCV(30);
      const stochDefault = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Stochastic",
      });
      const stochCustom = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "Stochastic",
        params: { period: 5, signalPeriod: 2 },
      });
      // Shorter periods produce more output rows.
      expect(stochCustom.values.length).toBeGreaterThan(
        stochDefault.values.length
      );

      const adxDefault = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "ADX",
      });
      const adxCustom = AnalyticsService.technicalIndicator({
        records,
        dateColumn: "date",
        valueColumn: "close",
        indicator: "ADX",
        params: { period: 5 },
      });
      expect(adxCustom.values.length).toBeGreaterThan(
        adxDefault.values.length
      );
    });
  });

  // -----------------------------------------------------------------------
  // npv
  // -----------------------------------------------------------------------

  describe("npv()", () => {
    it("should compute net present value", () => {
      const result = AnalyticsService.npv({
        rate: 0.1,
        cashFlows: [-1000, 300, 300, 300, 300, 300],
      });

      expect(result.npv).toBeCloseTo(137.24, 0);
    });

    it("should return negative NPV for bad investment", () => {
      const result = AnalyticsService.npv({
        rate: 0.2,
        cashFlows: [-1000, 100, 100, 100],
      });

      expect(result.npv).toBeLessThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // irr
  // -----------------------------------------------------------------------

  describe("irr()", () => {
    it("should compute internal rate of return", () => {
      const result = AnalyticsService.irr({
        cashFlows: [-1000, 300, 300, 300, 300, 300],
      });

      expect(result.irr).toBeCloseTo(0.1524, 2);
    });
  });

  // -----------------------------------------------------------------------
  // tvm
  // -----------------------------------------------------------------------

  describe("tvm()", () => {
    it("op: 'pv' matches the present-value of a $1,000/year 10-year annuity at 5%", () => {
      // Reference: financial.pv(0.05, 10, -1000) === 7721.734929184817
      const result = AnalyticsService.tvm({
        op: "pv",
        rate: 0.05,
        nper: 10,
        pmt: -1000,
      });
      expect(result.result).toBeCloseTo(7721.734929184817, 6);
    });

    it("op: 'fv' matches the future-value of $200/month at 6%/yr for 10 years", () => {
      // Reference: financial.fv(0.005, 120, -200, 0) === 32775.8693612916
      const result = AnalyticsService.tvm({
        op: "fv",
        rate: 0.005,
        nper: 120,
        pmt: -200,
        pv: 0,
      });
      expect(result.result).toBeCloseTo(32775.8693612916, 6);
    });

    it("op: 'pmt' matches the mortgage payment for $200k @ 6%/yr over 30 years", () => {
      // Reference: financial.pmt(0.005, 360, 200000) === -1199.10
      const result = AnalyticsService.tvm({
        op: "pmt",
        rate: 0.005,
        nper: 360,
        pv: 200000,
      });
      expect(result.result).toBeCloseTo(-1199.1010503055138, 6);
    });

    it("op: 'nper' is finite and positive for a payable loan", () => {
      const result = AnalyticsService.tvm({
        op: "nper",
        rate: 0.01,
        pmt: -200,
        pv: 10000,
      });
      expect(Number.isFinite(result.result)).toBe(true);
      expect(result.result).toBeGreaterThan(0);
      // Reference: financial.nper(0.01, -200, 10000) === 69.66
      expect(result.result).toBeCloseTo(69.66071689357483, 4);
    });

    it("op: 'rate' round-trips against tvm/pv at a known rate", () => {
      // pick rate = 0.04, derive pv, recover rate
      const rate = 0.04;
      const pv = AnalyticsService.tvm({
        op: "pv",
        rate,
        nper: 10,
        pmt: -100,
      }).result;
      const recovered = AnalyticsService.tvm({
        op: "rate",
        nper: 10,
        pmt: -100,
        pv,
        fv: 0,
      }).result;
      expect(recovered).toBeCloseTo(rate, 6);
    });

    it("missing input throws an error naming the missing field", () => {
      expect(() =>
        AnalyticsService.tvm({
          op: "pv",
          rate: 0.05,
          nper: 10,
          // pmt omitted
        })
      ).toThrow(/Missing input for op="pv".*pmt/);
    });
  });

  // -----------------------------------------------------------------------
  // xnpv
  // -----------------------------------------------------------------------

  describe("xnpv()", () => {
    it("matches financial.npv on yearly cashflows in non-leap years", () => {
      // Dates 2021-01-01..2024-01-01 — 365/730/1095 days from anchor, no
      // leap-day offset, so xnpv exactly matches financial.npv at the same
      // rate over the same flows.
      const flows = [
        { date: "2021-01-01", amount: -1000 },
        { date: "2022-01-01", amount: 300 },
        { date: "2023-01-01", amount: 400 },
        { date: "2024-01-01", amount: 500 },
      ];
      const result = AnalyticsService.xnpv({ rate: 0.1, cashFlows: flows });
      expect(result.xnpv).toBeCloseTo(-21.0368144252443, 6);
    });

    it("is order-independent — shuffling input gives the same xnpv", () => {
      const flows = [
        { date: "2021-01-01", amount: -1000 },
        { date: "2022-01-01", amount: 300 },
        { date: "2023-01-01", amount: 400 },
        { date: "2024-01-01", amount: 500 },
      ];
      const sorted = AnalyticsService.xnpv({ rate: 0.1, cashFlows: flows });
      const shuffled = AnalyticsService.xnpv({
        rate: 0.1,
        cashFlows: [flows[3], flows[0], flows[2], flows[1]],
      });
      expect(shuffled.xnpv).toBeCloseTo(sorted.xnpv, 9);
    });

    it("anchor is the earliest date — uniformly shifting all dates by N years preserves the xnpv", () => {
      const a = AnalyticsService.xnpv({
        rate: 0.1,
        cashFlows: [
          { date: "2021-01-01", amount: -1000 },
          { date: "2022-01-01", amount: 300 },
          { date: "2023-01-01", amount: 400 },
        ],
      });
      // Pick another leap-year-free stretch so the day-spans match exactly.
      const b = AnalyticsService.xnpv({
        rate: 0.1,
        cashFlows: [
          { date: "2017-01-01", amount: -1000 },
          { date: "2018-01-01", amount: 300 },
          { date: "2019-01-01", amount: 400 },
        ],
      });
      expect(a.xnpv).toBeCloseTo(b.xnpv, 6);
    });

    it("Zod rejects single-flow input (.min(2))", async () => {
      const { XnpvTool } = await import("../../tools/xnpv.tool.js");
      const tool = new XnpvTool();
      const result = tool.schema.safeParse({
        rate: 0.1,
        cashFlows: [{ date: "2024-01-01", amount: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it("invalid date string throws", () => {
      expect(() =>
        AnalyticsService.xnpv({
          rate: 0.1,
          cashFlows: [
            { date: "2024-01-01", amount: -100 },
            { date: "not-a-date", amount: 200 },
          ],
        })
      ).toThrow(/Invalid cash-flow date/);
    });
  });

  // -----------------------------------------------------------------------
  // xirr
  // -----------------------------------------------------------------------

  describe("xirr()", () => {
    // Reference fixture from Microsoft's XIRR documentation.
    // Excel returns 0.373362535 (≈ 37.34%).
    const MS_FIXTURE = [
      { date: "2008-01-01", amount: -10000 },
      { date: "2008-03-01", amount: 2750 },
      { date: "2008-10-30", amount: 4250 },
      { date: "2009-02-15", amount: 3250 },
      { date: "2009-04-01", amount: 2750 },
    ];

    it("matches Excel's XIRR on the Microsoft reference fixture", () => {
      const result = AnalyticsService.xirr({ cashFlows: MS_FIXTURE });
      expect(result.xirr).toBeCloseTo(0.373362535, 4);
    });

    it("inverse-relationship to xnpv: xnpv(xirr, flows) ≈ 0", () => {
      const { xirr } = AnalyticsService.xirr({ cashFlows: MS_FIXTURE });
      const { xnpv } = AnalyticsService.xnpv({
        rate: xirr,
        cashFlows: MS_FIXTURE,
      });
      expect(Math.abs(xnpv)).toBeLessThan(1e-6);
    });

    it("throws when all flows are positive", () => {
      expect(() =>
        AnalyticsService.xirr({
          cashFlows: [
            { date: "2024-01-01", amount: 100 },
            { date: "2024-06-01", amount: 200 },
            { date: "2024-12-01", amount: 300 },
          ],
        })
      ).toThrow(/at least one positive and one negative/);
    });

    it("throws when all flows are negative", () => {
      expect(() =>
        AnalyticsService.xirr({
          cashFlows: [
            { date: "2024-01-01", amount: -100 },
            { date: "2024-06-01", amount: -200 },
            { date: "2024-12-01", amount: -300 },
          ],
        })
      ).toThrow(/at least one positive and one negative/);
    });

    it("converges from a non-default initial guess", () => {
      // 100% guess vs. default 10% — still well above the true ~37% root,
      // but in Newton-Raphson's basin of attraction.
      const result = AnalyticsService.xirr({
        cashFlows: MS_FIXTURE,
        guess: 1.0,
      });
      expect(result.xirr).toBeCloseTo(0.373362535, 4);
    });
  });

  // -----------------------------------------------------------------------
  // depreciation
  // -----------------------------------------------------------------------

  describe("depreciation()", () => {
    it("straight-line schedule has constant per-period expense", () => {
      const result = AnalyticsService.depreciation({
        cost: 10000,
        salvage: 1000,
        life: 5,
        method: "straight_line",
      });
      if ("schedule" in result) {
        expect(result.schedule).toHaveLength(5);
        for (const row of result.schedule) {
          expect(row.depreciation).toBe(1800); // (10000 - 1000) / 5
        }
        expect(result.schedule[0].accumulated).toBe(1800);
        expect(result.schedule[4].accumulated).toBe(9000);
        expect(result.schedule[4].bookValue).toBe(1000);
      } else {
        throw new Error("expected schedule, got row");
      }
    });

    it("single-period query returns a row field, not a schedule", () => {
      const result = AnalyticsService.depreciation({
        cost: 10000,
        salvage: 1000,
        life: 5,
        method: "straight_line",
        period: 3,
      });
      expect("row" in result).toBe(true);
      expect("schedule" in result).toBe(false);
      if ("row" in result) {
        expect(result.row).toEqual({
          period: 3,
          depreciation: 1800,
          accumulated: 5400,
          bookValue: 4600,
        });
      }
    });

    it("double-declining-balance frontloads expense", () => {
      const result = AnalyticsService.depreciation({
        cost: 10000,
        salvage: 1000,
        life: 5,
        method: "double_declining_balance",
      });
      if ("schedule" in result) {
        // rate = 2/5 = 0.4
        expect(result.schedule[0].depreciation).toBe(4000); // 0.4 * 10000
        expect(result.schedule[1].depreciation).toBe(2400); // 0.4 * 6000
        expect(result.schedule[result.schedule.length - 1].bookValue).toBe(
          1000
        );
      } else {
        throw new Error("expected schedule");
      }
    });

    it("DDB final accumulated depreciation equals cost - salvage exactly", () => {
      const result = AnalyticsService.depreciation({
        cost: 10000,
        salvage: 1000,
        life: 5,
        method: "double_declining_balance",
      });
      if ("schedule" in result) {
        const total = result.schedule.reduce(
          (sum, row) => sum + row.depreciation,
          0
        );
        expect(Math.round(total * 100) / 100).toBe(9000);
      }
    });

    it("declining-balance honors a custom factor", () => {
      const result = AnalyticsService.depreciation({
        cost: 10000,
        salvage: 1000,
        life: 5,
        method: "declining_balance",
        factor: 1.5,
      });
      if ("schedule" in result) {
        // rate = 1.5/5 = 0.3
        expect(result.schedule[0].depreciation).toBe(3000); // 0.3 * 10000
      }
    });

    it("period > life throws a clear error", () => {
      expect(() =>
        AnalyticsService.depreciation({
          cost: 10000,
          salvage: 1000,
          life: 5,
          method: "straight_line",
          period: 7,
        })
      ).toThrow(/period 7 exceeds life 5/);
    });
  });

  // -----------------------------------------------------------------------
  // bondMath
  // -----------------------------------------------------------------------

  describe("bondMath()", () => {
    it("price of a 5% semi-annual coupon, 10-year, par-1000 bond at 5% yield is exactly par", () => {
      const result = AnalyticsService.bondMath({
        op: "price",
        face: 1000,
        couponRate: 0.05,
        maturity: 10,
        frequency: 2,
        yield: 0.05,
      });
      expect("price" in result).toBe(true);
      if ("price" in result) {
        expect(result.price).toBeCloseTo(1000, 6);
      }
    });

    it("discount bond — price below par when yield exceeds coupon", () => {
      const result = AnalyticsService.bondMath({
        op: "price",
        face: 1000,
        couponRate: 0.05,
        maturity: 10,
        frequency: 2,
        yield: 0.06,
      });
      if ("price" in result) {
        expect(result.price).toBeLessThan(1000);
      } else {
        throw new Error("expected price result");
      }
    });

    it("premium bond — price above par when yield is below coupon", () => {
      const result = AnalyticsService.bondMath({
        op: "price",
        face: 1000,
        couponRate: 0.05,
        maturity: 10,
        frequency: 2,
        yield: 0.04,
      });
      if ("price" in result) {
        expect(result.price).toBeGreaterThan(1000);
      } else {
        throw new Error("expected price result");
      }
    });

    it("YTM round-trips against price", () => {
      const priceResult = AnalyticsService.bondMath({
        op: "price",
        face: 1000,
        couponRate: 0.05,
        maturity: 10,
        frequency: 2,
        yield: 0.045,
      });
      if (!("price" in priceResult)) {
        throw new Error("expected price result");
      }
      const ytmResult = AnalyticsService.bondMath({
        op: "ytm",
        face: 1000,
        couponRate: 0.05,
        maturity: 10,
        frequency: 2,
        price: priceResult.price,
      });
      if (!("yield" in ytmResult)) {
        throw new Error("expected yield result");
      }
      expect(ytmResult.yield).toBeCloseTo(0.045, 6);
      expect(ytmResult.iterations).toBeLessThan(20);
    });

    it("Macaulay duration of a zero-coupon bond equals time to maturity", () => {
      const result = AnalyticsService.bondMath({
        op: "duration",
        face: 100,
        couponRate: 0,
        maturity: 5,
        frequency: 1,
        yield: 0.05,
      });
      if (!("macaulayDuration" in result)) {
        throw new Error("expected duration result");
      }
      expect(result.macaulayDuration).toBeCloseTo(5, 6);
      // Modified D = Macaulay / (1 + r) = 5 / 1.05 ≈ 4.7619
      expect(result.modifiedDuration).toBeCloseTo(4.7619, 3);
    });

    it("convexity of a zero-coupon bond matches the closed-form value", () => {
      const result = AnalyticsService.bondMath({
        op: "convexity",
        face: 100,
        couponRate: 0,
        maturity: 5,
        frequency: 1,
        yield: 0.05,
      });
      if (!("convexity" in result)) {
        throw new Error("expected convexity result");
      }
      // For a zero-coupon at frequency 1: convexity = N(N+1)/(1+r)² = 30/1.1025 ≈ 27.21
      expect(result.convexity).toBeCloseTo(30 / 1.1025, 3);
    });

    it("missing yield throws on op = price", () => {
      expect(() =>
        AnalyticsService.bondMath({
          op: "price",
          face: 1000,
          couponRate: 0.05,
          maturity: 10,
          frequency: 2,
        })
      ).toThrow(/yield is required for op = price/);
    });

    it("missing price throws on op = ytm", () => {
      expect(() =>
        AnalyticsService.bondMath({
          op: "ytm",
          face: 1000,
          couponRate: 0.05,
          maturity: 10,
          frequency: 2,
        })
      ).toThrow(/price is required for op = ytm/);
    });
  });

  // -----------------------------------------------------------------------
  // portfolioMetrics
  // -----------------------------------------------------------------------

  describe("portfolioMetrics()", () => {
    /**
     * 24 monthly returns averaging ~1.2% with mild deterministic noise
     * spanning both signs (range ≈ [-0.4%, +2.8%]). The variation is
     * large enough that the Sortino downside-deviation calculation has
     * non-zero observations to work with.
     */
    const PORTFOLIO_RECORDS = Array.from({ length: 24 }, (_, i) => ({
      value: 0.012 + ((i % 5) - 2) * 0.008,
    }));

    it("returns standalone metrics; benchmark fields absent without benchmark", () => {
      const result = AnalyticsService.portfolioMetrics({
        records: PORTFOLIO_RECORDS,
        returnColumn: "value",
        periodicity: "monthly",
      });
      // Mean return ~1.2%/month → (1.012)^24 ≈ 1.331, totalReturn ≈ 0.33
      expect(result.totalReturn).toBeGreaterThan(0.2);
      expect(result.totalReturn).toBeLessThan(0.45);
      // CAGR annualized
      expect(result.cagr).toBeGreaterThan(0.10);
      expect(result.cagr).toBeLessThan(0.20);
      expect(result.sortino).toBeGreaterThan(0);
      expect(Number.isFinite(result.calmar)).toBe(true);
      expect(typeof result.maxDrawdown).toBe("number");
      expect("beta" in result).toBe(false);
      expect("alpha" in result).toBe(false);
      expect("informationRatio" in result).toBe(false);
      expect("trackingError" in result).toBe(false);
      expect("upCapture" in result).toBe(false);
      expect("downCapture" in result).toBe(false);
    });

    it("benchmark-relative metrics are emitted when benchmark is supplied", () => {
      const benchmarkRecords = PORTFOLIO_RECORDS.map((r) => ({
        bench: r.value,
      }));
      const result = AnalyticsService.portfolioMetrics({
        records: PORTFOLIO_RECORDS,
        returnColumn: "value",
        benchmarkRecords,
        benchmarkReturnColumn: "bench",
        periodicity: "monthly",
      });
      expect(result.beta).toBeDefined();
      expect(result.alpha).toBeDefined();
      expect(result.informationRatio).toBeDefined();
      expect(result.trackingError).toBeDefined();
      // Identical portfolio + benchmark → beta=1, alpha≈0, te≈0
      expect(result.beta!).toBeCloseTo(1, 9);
      expect(Math.abs(result.alpha!)).toBeLessThan(1e-9);
      expect(result.trackingError!).toBeCloseTo(0, 9);
    });

    it("beta is 0 for a constant portfolio against a non-trivial benchmark", () => {
      const portfolio = Array.from({ length: 12 }, () => ({ value: 0 }));
      const benchmarkRecords = Array.from({ length: 12 }, (_, i) => ({
        bench: ((i % 5) - 2) * 0.01,
      }));
      const result = AnalyticsService.portfolioMetrics({
        records: portfolio,
        returnColumn: "value",
        benchmarkRecords,
        benchmarkReturnColumn: "bench",
      });
      expect(result.beta!).toBeCloseTo(0, 9);
    });

    it("up-capture ≈ 1.5 and down-capture ≈ 0.5 on an engineered benchmark", () => {
      // Benchmark alternates +0.02 and -0.02. Portfolio captures 1.5x ups
      // and 0.5x downs.
      const benchmarkValues = Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0 ? 0.02 : -0.02
      );
      const portfolioValues = benchmarkValues.map((b) =>
        b > 0 ? 1.5 * b : 0.5 * b
      );
      const result = AnalyticsService.portfolioMetrics({
        records: portfolioValues.map((value) => ({ value })),
        returnColumn: "value",
        benchmarkRecords: benchmarkValues.map((bench) => ({ bench })),
        benchmarkReturnColumn: "bench",
      });
      expect(result.upCapture!).toBeCloseTo(1.5, 6);
      expect(result.downCapture!).toBeCloseTo(0.5, 6);
    });

    it("Sortino exceeds Sharpe for a positively-skewed series", () => {
      // Returns mostly small positive, occasional large positive, with
      // a single small negative so downside-deviation is well-defined.
      // Total stddev is dominated by the large positives (huge for
      // Sharpe), but downside dev is tiny (just the one negative) — so
      // Sortino dominates Sharpe.
      const returnsArr = Array.from({ length: 30 }, (_, i) =>
        i === 13 ? -0.002 : i % 10 === 0 ? 0.05 : 0.005
      );
      // For sharpeRatio we need a price series that yields these returns.
      const priceRecords: { date: string; price: number }[] = [];
      let price = 100;
      priceRecords.push({ date: "2024-01-01", price });
      for (let i = 0; i < returnsArr.length; i++) {
        price *= 1 + returnsArr[i];
        priceRecords.push({
          date: `2024-${String(i + 2).padStart(2, "0")}-01`,
          price,
        });
      }

      const portfolio = AnalyticsService.portfolioMetrics({
        records: returnsArr.map((value) => ({ value })),
        returnColumn: "value",
      });
      const sharpe = AnalyticsService.sharpeRatio({
        records: priceRecords,
        valueColumn: "price",
      });

      expect(portfolio.sortino).toBeGreaterThan(sharpe.sharpeRatio);
    });

    it("maxDrawdown matches a hand-computed value", () => {
      // returns = [+0.1, +0.1, -0.3, +0.05, +0.05]
      // wealth  = 1 → 1.1 → 1.21 → 0.847 → 0.88935 → 0.9338175
      // peak = 1.21, trough = 0.847; MDD = (1.21 - 0.847) / 1.21 = 0.3
      const records = [0.1, 0.1, -0.3, 0.05, 0.05].map((value) => ({
        value,
      }));
      const result = AnalyticsService.portfolioMetrics({
        records,
        returnColumn: "value",
      });
      expect(result.maxDrawdown).toBeCloseTo(0.3, 9);
    });

    it("throws when benchmark length mismatches portfolio length", () => {
      const portfolio = Array.from({ length: 24 }, () => ({ value: 0.01 }));
      const benchmarkRecords = Array.from({ length: 12 }, () => ({
        bench: 0.01,
      }));
      expect(() =>
        AnalyticsService.portfolioMetrics({
          records: portfolio,
          returnColumn: "value",
          benchmarkRecords,
          benchmarkReturnColumn: "bench",
        })
      ).toThrow(/benchmark length must match portfolio length/);
    });
  });

  // -----------------------------------------------------------------------
  // varCvar
  // -----------------------------------------------------------------------

  describe("varCvar()", () => {
    it("historical VaR at 95% on a 16-element fixture flags the worst observation", () => {
      // n = 16; 0.05 quantile = 0.75 ⇒ between worst and second-worst.
      const records = [
        -0.05, -0.04, -0.03, -0.02, -0.015, -0.01, -0.005, 0.0, 0.005, 0.01,
        0.02, 0.03, 0.04, 0.05, 0.07, 0.10,
      ].map((value) => ({ value }));
      const result = AnalyticsService.varCvar({
        records,
        returnColumn: "value",
      });
      expect(result.method).toBe("historical");
      expect(result.confidence).toBe(0.95);
      // Loss at the lower tail — should be close to the worst observation
      expect(result.var).toBeGreaterThanOrEqual(0.04);
      expect(result.var).toBeLessThanOrEqual(0.05);
    });

    it("historical CVaR is at least as large as VaR", () => {
      const records = [
        -0.05, -0.04, -0.03, -0.02, -0.015, -0.01, -0.005, 0.0, 0.005, 0.01,
        0.02, 0.03, 0.04, 0.05, 0.07, 0.10,
      ].map((value) => ({ value }));
      const result = AnalyticsService.varCvar({
        records,
        returnColumn: "value",
      });
      expect(result.cvar).toBeGreaterThanOrEqual(result.var);
    });

    it("parametric VaR matches the closed-form Gaussian formula", () => {
      // Deterministic synthetic returns; compute mu/sigma inline and
      // assert against the Gaussian formula instead of textbook values.
      const records = Array.from({ length: 1000 }, (_, i) => ({
        value:
          (Math.sin((i * 13) / 7) + Math.cos((i * 17) / 11)) * 0.01,
      }));
      const result = AnalyticsService.varCvar({
        records,
        returnColumn: "value",
        method: "parametric",
      });
      // Compute expected via the same formula — sample stddev (n-1)
      const values = records.map((r) => r.value);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance =
        values.reduce((s, v) => s + (v - mean) * (v - mean), 0) /
        (values.length - 1);
      const sigma = Math.sqrt(variance);
      // Standard-normal Φ⁻¹(0.05) ≈ -1.6449
      const z = -1.6449;
      const expectedVar = -(mean + z * sigma);
      expect(result.var).toBeCloseTo(expectedVar, 2);
    });

    it("parametric CVaR follows the closed-form formula", () => {
      const records = Array.from({ length: 1000 }, (_, i) => ({
        value:
          (Math.sin((i * 13) / 7) + Math.cos((i * 17) / 11)) * 0.01,
      }));
      const result = AnalyticsService.varCvar({
        records,
        returnColumn: "value",
        method: "parametric",
      });
      const values = records.map((r) => r.value);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance =
        values.reduce((s, v) => s + (v - mean) * (v - mean), 0) /
        (values.length - 1);
      const sigma = Math.sqrt(variance);
      const z = -1.6449;
      const phi = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
      const expectedCvar = -(mean - sigma * (phi / (1 - 0.95)));
      expect(result.cvar).toBeCloseTo(expectedCvar, 2);
    });

    it("tailCount is present for historical and absent for parametric", () => {
      const records = [
        -0.05, -0.04, -0.03, -0.02, -0.015, -0.01, -0.005, 0.0, 0.005, 0.01,
        0.02, 0.03, 0.04, 0.05, 0.07, 0.10,
      ].map((value) => ({ value }));
      const historical = AnalyticsService.varCvar({
        records,
        returnColumn: "value",
        method: "historical",
      });
      const parametric = AnalyticsService.varCvar({
        records,
        returnColumn: "value",
        method: "parametric",
      });
      expect("tailCount" in historical).toBe(true);
      expect("tailCount" in parametric).toBe(false);
    });

    it("confidence: 0.99 produces a larger VaR than 0.95", () => {
      const records = Array.from({ length: 200 }, (_, i) => ({
        value: ((i % 13) - 6) * 0.01,
      }));
      const var95 = AnalyticsService.varCvar({
        records,
        returnColumn: "value",
        confidence: 0.95,
      });
      const var99 = AnalyticsService.varCvar({
        records,
        returnColumn: "value",
        confidence: 0.99,
      });
      expect(var99.var).toBeGreaterThanOrEqual(var95.var);
    });
  });

  // -----------------------------------------------------------------------
  // amortize
  // -----------------------------------------------------------------------

  describe("amortize()", () => {
    it("should generate an amortization schedule", () => {
      const result = AnalyticsService.amortize({
        principal: 100000,
        annualRate: 0.06,
        periods: 360,
      });

      expect(result).toHaveLength(360);
      expect(result[0].period).toBe(1);
      expect(result[0].payment).toBeGreaterThan(0);
      expect(result[0].interest).toBeCloseTo(500, 0); // 100000 * 0.06/12
      expect(result[0].principal).toBeGreaterThan(0);
      expect(result[359].period).toBe(360);
      expect(result[359].balance).toBeCloseTo(0, 0);
    });

    it("default behavior is byte-stable against the pre-change baseline", () => {
      // Baseline captured before the compounding/extraPayment widening:
      //   principal: 200000, annualRate: 0.06, periods: 360
      //   row[0].payment === 1199.10
      //   row[359].balance === 0
      //   length === 360
      const result = AnalyticsService.amortize({
        principal: 200000,
        annualRate: 0.06,
        periods: 360,
      });
      expect(result).toHaveLength(360);
      expect(result[0].payment).toBe(1199.1);
      expect(result[359].balance).toBe(0);
    });

    it("quarterly compounding uses annualRate / 4 as the periodic rate", () => {
      const result = AnalyticsService.amortize({
        principal: 10000,
        annualRate: 0.06,
        periods: 20,
        compounding: "quarterly",
      });
      expect(result).toHaveLength(20);
      // periodic rate = 0.06 / 4 = 0.015 → row 1 interest = 10000 * 0.015 = 150
      expect(result[0].interest).toBeCloseTo(150, 2);
    });

    it("annual compounding has interest = principal × annualRate in row 1", () => {
      const result = AnalyticsService.amortize({
        principal: 10000,
        annualRate: 0.06,
        periods: 5,
        compounding: "annual",
      });
      expect(result).toHaveLength(5);
      expect(result[0].interest).toBeCloseTo(600, 2);
    });

    it("extraPayment shortens the schedule and lands the final balance at 0", () => {
      const baseline = AnalyticsService.amortize({
        principal: 200000,
        annualRate: 0.06,
        periods: 360,
      });
      const accelerated = AnalyticsService.amortize({
        principal: 200000,
        annualRate: 0.06,
        periods: 360,
        extraPayment: 500,
      });
      expect(baseline).toHaveLength(360);
      expect(accelerated.length).toBeLessThan(360);
      expect(accelerated[accelerated.length - 1].balance).toBe(0);
    });

    it("each amortization row's principal + interest equals payment (within rounding)", () => {
      const result = AnalyticsService.amortize({
        principal: 200000,
        annualRate: 0.06,
        periods: 360,
        extraPayment: 500,
      });
      for (const row of result) {
        expect(Math.abs(row.principal + row.interest - row.payment)).toBeLessThan(0.02);
      }
    });

    it("zero annualRate produces a flat schedule with no interest", () => {
      const result = AnalyticsService.amortize({
        principal: 1000,
        annualRate: 0,
        periods: 10,
        compounding: "monthly",
      });
      expect(result).toHaveLength(10);
      for (const row of result) {
        expect(row.interest).toBe(0);
        expect(row.principal).toBe(100);
        expect(row.payment).toBe(100);
      }
      expect(result[9].balance).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // sharpeRatio
  // -----------------------------------------------------------------------

  describe("sharpeRatio()", () => {
    it("should compute Sharpe ratio", () => {
      const result = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
      });

      expect(typeof result.sharpeRatio).toBe("number");
      expect(result.sharpeRatio).toBeGreaterThan(0); // generally positive since val trends up
    });

    it("annualizes via periodicity: 'daily'", () => {
      const plain = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
      });

      const annualized = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
        periodicity: "daily",
      });

      // Annualized should be larger in magnitude (multiplied by √252)
      expect(Math.abs(annualized.sharpeRatio)).toBeGreaterThan(
        Math.abs(plain.sharpeRatio)
      );
      expect(annualized.sharpeRatio).toBeCloseTo(
        plain.sharpeRatio * Math.sqrt(252),
        9
      );
    });

    it("omitted periodicity returns the raw per-period ratio", () => {
      // Reference series modeled after Hyndman/Athanasopoulos §3 — short
      // monthly returns with positive drift.
      const returns = [
        0.012, -0.005, 0.018, 0.022, -0.008, 0.015, 0.003, 0.011, -0.002, 0.025,
      ];
      // Reconstruct as a price series so the (v[i] - v[i-1])/v[i-1] returns
      // calculation yields the `returns` array exactly.
      const records: { d: string; v: number }[] = [{ d: "2024-00", v: 100 }];
      let v = 100;
      for (let i = 0; i < returns.length; i++) {
        v = v * (1 + returns[i]);
        records.push({ d: `2024-${String(i + 1).padStart(2, "0")}`, v });
      }

      const result = AnalyticsService.sharpeRatio({
        records,
        valueColumn: "v",
      });

      // raw = mean(returns) / stddev(returns) — population stddev to match
      // simple-statistics' ss.standardDeviation (divisor n, not n-1)
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const stddev = (xs: number[]) => {
        const m = mean(xs);
        return Math.sqrt(
          xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / xs.length
        );
      };
      const expected = mean(returns) / stddev(returns);
      expect(result.sharpeRatio).toBeCloseTo(expected, 9);
    });

    it("periodicity: 'weekly' multiplies by √52", () => {
      const raw = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
      });
      const weekly = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
        periodicity: "weekly",
      });
      expect(weekly.sharpeRatio).toBeCloseTo(raw.sharpeRatio * Math.sqrt(52), 9);
    });

    it("periodicity: 'monthly' multiplies by √12", () => {
      const raw = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
      });
      const monthly = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
        periodicity: "monthly",
      });
      expect(monthly.sharpeRatio).toBeCloseTo(
        raw.sharpeRatio * Math.sqrt(12),
        9
      );
    });

    it("periodicity: 'quarterly' multiplies by 2 exactly", () => {
      const raw = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
      });
      const quarterly = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
        periodicity: "quarterly",
      });
      expect(quarterly.sharpeRatio).toBeCloseTo(raw.sharpeRatio * 2, 9);
    });

    it("periodicity: 'annual' is a no-op", () => {
      const raw = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
      });
      const annual = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
        periodicity: "annual",
      });
      expect(annual.sharpeRatio).toBeCloseTo(raw.sharpeRatio, 9);
    });

    it("should throw for fewer than 2 values", () => {
      expect(() =>
        AnalyticsService.sharpeRatio({
          records: [{ val: 100 }],
          valueColumn: "val",
        })
      ).toThrow("At least 2 values");
    });
  });

  // -----------------------------------------------------------------------
  // maxDrawdown
  // -----------------------------------------------------------------------

  describe("maxDrawdown()", () => {
    it("should compute maximum drawdown with peak and trough dates", () => {
      const records = [
        { date: "2024-01-01", price: 100 },
        { date: "2024-01-02", price: 120 },
        { date: "2024-01-03", price: 90 }, // trough after peak of 120
        { date: "2024-01-04", price: 110 },
        { date: "2024-01-05", price: 130 },
      ];

      const result = AnalyticsService.maxDrawdown({
        records,
        dateColumn: "date",
        valueColumn: "price",
      });

      // Drawdown = (120 - 90) / 120 = 0.25
      expect(result.maxDrawdown).toBeCloseTo(0.25, 2);
      expect(result.peakDate).toBe("2024-01-02");
      expect(result.troughDate).toBe("2024-01-03");
    });

    it("should return 0 for monotonically increasing data", () => {
      const records = [
        { date: "2024-01-01", price: 100 },
        { date: "2024-01-02", price: 110 },
        { date: "2024-01-03", price: 120 },
      ];

      const result = AnalyticsService.maxDrawdown({
        records,
        dateColumn: "date",
        valueColumn: "price",
      });

      expect(result.maxDrawdown).toBe(0);
      expect(result.peakDate).toBeNull();
      expect(result.troughDate).toBeNull();
    });

    it("should handle empty records", () => {
      const result = AnalyticsService.maxDrawdown({
        records: [],
        dateColumn: "date",
        valueColumn: "price",
      });

      expect(result.maxDrawdown).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // rollingReturns
  // -----------------------------------------------------------------------

  describe("rollingReturns()", () => {
    it("should compute period-over-period returns within rolling window", () => {
      const records = [
        { date: "2024-01-01", price: 100 },
        { date: "2024-01-02", price: 110 },
        { date: "2024-01-03", price: 105 },
        { date: "2024-01-04", price: 120 },
        { date: "2024-01-05", price: 115 },
      ];

      const result = AnalyticsService.rollingReturns({
        records,
        dateColumn: "date",
        valueColumn: "price",
        window: 2,
      });

      expect(result.dates).toHaveLength(3);
      expect(result.returns).toHaveLength(3);
      // First return: (105 - 100) / 100 = 0.05
      expect(result.returns[0]).toBeCloseTo(0.05, 2);
      // Second return: (120 - 110) / 110 ≈ 0.0909
      expect(result.returns[1]).toBeCloseTo(0.0909, 3);
    });

    it("should return empty for window larger than dataset", () => {
      const records = [
        { date: "2024-01-01", price: 100 },
        { date: "2024-01-02", price: 110 },
      ];

      const result = AnalyticsService.rollingReturns({
        records,
        dateColumn: "date",
        valueColumn: "price",
        window: 5,
      });

      expect(result.dates).toHaveLength(0);
      expect(result.returns).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Batch cache methods
  // -----------------------------------------------------------------------

  // Phase 3 slice 2: the batch `apply*` methods continue to mutate the
  // AlaSQL cache (slice 5 deletes them entirely), but the verification
  // probe in each test below — `AnalyticsService.sqlQuery(...)` against
  // the same AlaSQL cache — no longer works because `sqlQuery` is now
  // the Postgres-direct entrypoint. Slice 5's "AlaSQL surface deletion"
  // (cases 70–71) replaces these with two new tests: (a) each mutation
  // tool no longer issues `apply*` calls, and (b) the next `sql_query`
  // SELECT sees the committed Postgres write.
  describe.skip("batch cache methods — AlaSQL-coupled, retired in slice 2", () => {
    it("placeholder", () => {
      expect(true).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Distribution CDFs (private helpers; tested via cast access)
  // -----------------------------------------------------------------------

  describe("distribution CDFs (private)", () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const svc = AnalyticsService as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    it("tCDF(0, df) is 0.5 for any df", () => {
      for (const df of [1, 5, 10, 50, 100]) {
        expect(svc.tCDF(0, df)).toBeCloseTo(0.5, 9);
      }
    });

    it("tCDF matches scipy at df=10, t=1.812 (one-tailed 95%)", () => {
      // scipy.stats.t.cdf(1.812, 10) ≈ 0.95
      expect(svc.tCDF(1.812, 10)).toBeCloseTo(0.95, 3);
    });

    it("tCDF is symmetric: tCDF(-t, df) === 1 - tCDF(t, df)", () => {
      for (const [t, df] of [
        [0.5, 5],
        [1.5, 10],
        [2.0, 20],
        [3.0, 50],
      ]) {
        expect(svc.tCDF(-t, df)).toBeCloseTo(1 - svc.tCDF(t, df), 6);
      }
    });

    it("tCDF matches scipy at df=10, t=2.228 (two-tailed 95%)", () => {
      // scipy.stats.t.cdf(2.228, 10) ≈ 0.975
      expect(svc.tCDF(2.228, 10)).toBeCloseTo(0.975, 3);
    });

    it("chiSquaredCDF(0, df) is 0", () => {
      for (const df of [1, 5, 10, 100]) {
        expect(svc.chiSquaredCDF(0, df)).toBeCloseTo(0, 9);
      }
    });

    it("chiSquaredCDF matches scipy at df=5, x=11.07 (95th percentile)", () => {
      // scipy.stats.chi2.cdf(11.07, 5) ≈ 0.95
      expect(svc.chiSquaredCDF(11.07, 5)).toBeCloseTo(0.95, 3);
    });

    it("chiSquaredCDF matches scipy at df=5, x=15.09 (99th percentile)", () => {
      // scipy.stats.chi2.cdf(15.09, 5) ≈ 0.99
      expect(svc.chiSquaredCDF(15.09, 5)).toBeCloseTo(0.99, 3);
    });

    it("chiSquaredCDF is monotonic non-decreasing in x", () => {
      const df = 10;
      let prev = -Infinity;
      for (const x of [0, 1, 5, 10, 20, 50, 100]) {
        const v = svc.chiSquaredCDF(x, df);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });

    it("tInverseCDF(0.5, df) === 0 for any df", () => {
      for (const df of [1, 5, 10, 50, 100]) {
        expect(svc.tInverseCDF(0.5, df)).toBeCloseTo(0, 9);
      }
    });

    it("tInverseCDF(0.975, 10) ≈ 2.228 (scipy reference)", () => {
      // scipy.stats.t.ppf(0.975, 10) === 2.2281388519649385
      expect(svc.tInverseCDF(0.975, 10)).toBeCloseTo(2.228, 3);
    });

    it("tInverseCDF(0.95, large df) approaches the standard-normal 95th pctl", () => {
      // Standard normal: Φ⁻¹(0.95) ≈ 1.6449
      expect(svc.tInverseCDF(0.95, 1000)).toBeCloseTo(1.6449, 2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Phase 3 slice 5 — AlaSQL surface deletion (cases 66-70)
  // ─────────────────────────────────────────────────────────────────────

  describe("AlaSQL surface deletion (slice 5)", () => {
    // Case 67
    it("does not export the cache surface (stationDatabases, getOrCreateDatabase, dropDatabase, cleanup)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc: Record<string, unknown> = AnalyticsService as any;
      for (const name of [
        "stationDatabases",
        "getOrCreateDatabase",
        "dropDatabase",
        "cleanup",
      ]) {
        expect(svc[name]).toBeUndefined();
      }
    });

    // Case 67
    it("does not expose any apply*/cache* surface", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc: Record<string, unknown> = AnalyticsService as any;
      const applyMethods = [
        "applyRecordInsert",
        "applyRecordUpdate",
        "applyRecordDelete",
        "applyRecordInsertMany",
        "applyRecordUpdateMany",
        "applyRecordDeleteMany",
        "applyEntityInsert",
        "applyEntityUpdate",
        "applyEntityDelete",
        "applyEntityInsertMany",
        "applyEntityUpdateMany",
        "applyEntityDeleteMany",
        "applyColumnDefinitionInsert",
        "applyColumnDefinitionUpdate",
        "applyColumnDefinitionDelete",
        "applyFieldMappingInsert",
        "applyFieldMappingUpdate",
        "applyFieldMappingDelete",
        "applyFieldMappingInsertMany",
        "applyFieldMappingUpdateMany",
        "applyFieldMappingDeleteMany",
        "cacheInsert",
        "cacheUpsert",
        "cacheDelete",
        "cacheBatchInsert",
        "cacheBatchUpsert",
        "cacheBatchDelete",
      ];
      for (const m of applyMethods) {
        expect(svc[m]).toBeUndefined();
      }
    });

    // Case 68
    it("loadStation returns metadata-only — no `records` map field", async () => {
      mockFindByStationId.mockResolvedValue(STATION_INSTANCES);
      mockFindByConnectorInstanceId.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockFindFieldMappingsByEntityIds.mockResolvedValue(new Map());

      const result = await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      expect("records" in result).toBe(false);
      expect(result).toEqual({
        entities: [],
        entityGroups: [],
      });
    });

    // Case 69
    it("alasql is not declared as a runtime dependency in apps/api/package.json", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const url = await import("node:url");
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const pkg = JSON.parse(
        await fs.readFile(
          path.resolve(here, "../../../package.json"),
          "utf8"
        )
      ) as { dependencies?: Record<string, string> };
      expect(pkg.dependencies?.alasql).toBeUndefined();
    });

    // Case 70 — each mutation tool no longer references AnalyticsService.apply*
    it("no mutation tool issues an AnalyticsService.apply* call", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const url = await import("node:url");
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const toolsDir = path.resolve(here, "../../tools");
      const files = [
        "entity-record-create.tool.ts",
        "entity-record-update.tool.ts",
        "entity-record-delete.tool.ts",
        "field-mapping-create.tool.ts",
        "field-mapping-update.tool.ts",
        "field-mapping-delete.tool.ts",
        "connector-entity-create.tool.ts",
        "connector-entity-update.tool.ts",
        "connector-entity-delete.tool.ts",
      ];
      for (const f of files) {
        const src = await fs.readFile(path.join(toolsDir, f), "utf8");
        expect(src).not.toMatch(/AnalyticsService\.apply/);
        expect(src).not.toMatch(/AnalyticsService\.cache/);
      }
    });
  });
});
