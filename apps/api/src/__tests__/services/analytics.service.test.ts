/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
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

type VegaLiteSpecInput =
  import("../../tools/visualize.tool.js").VegaLiteSpecInput;

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
    AnalyticsService.cleanup(STATION_ID);
  });

  // -----------------------------------------------------------------------
  // loadStation
  // -----------------------------------------------------------------------

  describe("loadStation()", () => {
    it("should load entities, records, and register AlaSQL tables", async () => {
      setupLoadStationMocks();

      const result = await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      expect(result.entities).toHaveLength(3);
      expect(result.entities.map((e) => e.key)).toEqual([
        "customers",
        "orders",
        "products",
      ]);

      // Verify columns were built from field mappings
      const customersEntity = result.entities.find(
        (e) => e.key === "customers"
      )!;
      expect(customersEntity.columns).toHaveLength(3);
      expect(customersEntity.columns.map((c) => c.key)).toContain("name");
      expect(customersEntity.columns.map((c) => c.key)).toContain("email");

      // Verify records
      expect(result.records.get("customers")).toHaveLength(3);
      expect(result.records.get("orders")).toHaveLength(4);
      expect(result.records.get("products")).toHaveLength(2);

      // Verify AlaSQL tables work
      const sqlResult = AnalyticsService.sqlQuery({
        sql: "SELECT * FROM [customers]",
        stationId: STATION_ID,
      });
      expect(sqlResult).toHaveLength(3);
    });

    it("should return empty when station has no connector instances", async () => {
      mockFindByStationId.mockResolvedValue([]);

      const result = await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      expect(result.entities).toHaveLength(0);
      expect(result.entityGroups).toHaveLength(0);
      expect(result.records.size).toBe(0);
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

  describe("sqlQuery()", () => {
    it("should execute SQL against in-memory tables", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const result = AnalyticsService.sqlQuery({
        sql: "SELECT name, email FROM [customers] WHERE name = 'Alice'",
        stationId: STATION_ID,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: "Alice",
        email: "alice@example.com",
      });
    });

    it("should block SELECT INTO", () => {
      expect(() =>
        AnalyticsService.sqlQuery({
          sql: "SELECT INTO newtable FROM customers",
          stationId: STATION_ID,
        })
      ).toThrow("Blocked SQL operation");
    });

    it("should block ATTACH", () => {
      expect(() =>
        AnalyticsService.sqlQuery({
          sql: "ATTACH DATABASE file.db AS ext",
          stationId: STATION_ID,
        })
      ).toThrow("Blocked SQL operation");
    });

    it("should throw when station is not loaded", () => {
      expect(() =>
        AnalyticsService.sqlQuery({
          sql: "SELECT * FROM foo",
          stationId: "nonexistent",
        })
      ).toThrow("Station not loaded");
    });
  });

  // -----------------------------------------------------------------------
  // visualize
  // -----------------------------------------------------------------------

  describe("visualize()", () => {
    it("should inject SQL results into a Vega-Lite spec", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const spec = {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        mark: "bar",
        encoding: { x: { field: "name" }, y: { field: "amount" } },
      } as unknown as VegaLiteSpecInput;

      const result = await AnalyticsService.visualize({
        sql: "SELECT * FROM [products]",
        vegaLiteSpec: spec,
        stationId: STATION_ID,
      });

      expect((result as any).mark).toBe("bar");
      expect((result.data as { values: unknown[] }).values).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // visualizeVega
  // -----------------------------------------------------------------------

  describe("visualizeVega()", () => {
    it("should inject SQL results into data[0].values of a Vega spec", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const spec = {
        $schema: "https://vega.github.io/schema/vega/v5.json",
        data: [{ name: "table" }],
        marks: [{ type: "rect" }],
      };

      const result = await AnalyticsService.visualizeVega({
        sql: "SELECT * FROM [products]",
        vegaSpec: spec,
        stationId: STATION_ID,
      });

      expect(
        (result.data as unknown as Record<string, unknown>[])[0].values
      ).toHaveLength(2);
      expect(
        (result.data as unknown as Record<string, unknown>[])[0].name
      ).toBe("table");
      expect(result.marks).toEqual([{ type: "rect" }]);
    });

    it("should handle specs with no existing data array", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const spec = {
        $schema: "https://vega.github.io/schema/vega/v5.json",
        marks: [{ type: "arc" }],
      };

      const result = await AnalyticsService.visualizeVega({
        sql: "SELECT * FROM [products]",
        vegaSpec: spec,
        stationId: STATION_ID,
      });

      expect(Array.isArray(result.data)).toBe(true);
      expect(
        (result.data as unknown as Record<string, unknown>[])[0].values
      ).toHaveLength(2);
    });

    it("should preserve non-first data entries", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const spec = {
        data: [
          { name: "table" },
          { name: "links", values: [{ source: "a", target: "b" }] },
        ],
        marks: [],
      };

      const result = await AnalyticsService.visualizeVega({
        sql: "SELECT * FROM [products]",
        vegaSpec: spec,
        stationId: STATION_ID,
      });

      const data = result.data as unknown as Record<string, unknown>[];
      expect(data).toHaveLength(2);
      expect(data[1]).toEqual({
        name: "links",
        values: [{ source: "a", target: "b" }],
      });
    });

    it("should create a missing base dataset when data[0] has a source reference", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const spec = {
        $schema: "https://vega.github.io/schema/vega/v5.json",
        data: [
          {
            name: "node-data",
            source: "table",
            transform: [{ type: "filter", expr: "datum.type === 'node'" }],
          },
          {
            name: "link-data",
            source: "table",
            transform: [{ type: "filter", expr: "datum.type === 'edge'" }],
          },
        ],
        marks: [],
      };

      const result = await AnalyticsService.visualizeVega({
        sql: "SELECT * FROM [products]",
        vegaSpec: spec,
        stationId: STATION_ID,
      });

      const data = result.data as unknown as Record<string, unknown>[];
      // Should have prepended the "table" base dataset
      expect(data).toHaveLength(3);
      expect(data[0].name).toBe("table");
      expect(data[0].values).toHaveLength(2);
      // Original datasets preserved after the new base dataset
      expect(data[1].name).toBe("node-data");
      expect(data[1].source).toBe("table");
      expect(data[2].name).toBe("link-data");
      expect(data[2].source).toBe("table");
    });

    it("should inject into an existing source dataset when it is already defined", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const spec = {
        data: [
          { name: "raw", values: [] },
          {
            name: "filtered",
            source: "raw",
            transform: [{ type: "filter", expr: "true" }],
          },
        ],
        marks: [],
      };

      const result = await AnalyticsService.visualizeVega({
        sql: "SELECT * FROM [products]",
        vegaSpec: spec,
        stationId: STATION_ID,
      });

      const data = result.data as unknown as Record<string, unknown>[];
      // data[0] has no source field, so values injected directly (fallback path)
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe("raw");
      expect(data[0].values).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Vega spec validation
  // -----------------------------------------------------------------------

  describe("visualize() validation", () => {
    it("should throw when vega-lite compile fails", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const { compile } = await import("vega-lite");
      (compile as jest.Mock).mockImplementationOnce(() => {
        throw new Error("Unknown mark type");
      });

      await expect(
        AnalyticsService.visualize({
          sql: "SELECT * FROM [products]",
          vegaLiteSpec: { mark: "invalid" } as unknown as VegaLiteSpecInput,
          stationId: STATION_ID,
        })
      ).rejects.toThrow("Invalid Vega-Lite spec: Unknown mark type");
    });
  });

  describe("visualizeVega() validation", () => {
    it("should throw when vega view fails", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      mockViewRunAsync.mockRejectedValueOnce(
        new Error("Cannot read properties of undefined")
      );

      await expect(
        AnalyticsService.visualizeVega({
          sql: "SELECT * FROM [products]",
          vegaSpec: {
            data: [{ name: "table" }],
            marks: [{ type: "bad" }],
          } as Record<string, unknown>,
          stationId: STATION_ID,
        })
      ).rejects.toThrow(
        "Invalid Vega spec: Cannot read properties of undefined"
      );
    });
  });

  // -----------------------------------------------------------------------
  // resolveIdentity
  // -----------------------------------------------------------------------

  describe("resolveIdentity()", () => {
    const ENTITY_GROUPS = [
      {
        id: "eg-1",
        name: "Customer Identity",
        members: [
          {
            entityKey: "customers",
            linkColumnKey: "customer_id",
            linkColumnLabel: "Customer ID",
            isPrimary: true,
          },
          {
            entityKey: "orders",
            linkColumnKey: "customer_id",
            linkColumnLabel: "Customer ID",
            isPrimary: false,
          },
        ],
      },
    ];

    it("should return matched records grouped by entity with primary first", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const result = AnalyticsService.resolveIdentity({
        entityGroupName: "Customer Identity",
        linkValue: "C001",
        stationId: STATION_ID,
        entityGroups: ENTITY_GROUPS,
      });

      expect(result.matches).toHaveLength(2);
      // Primary entity (customers) should be first
      expect(result.matches[0].entityKey).toBe("customers");
      expect(result.matches[0].isPrimary).toBe(true);
      expect(result.matches[0].records).toHaveLength(1);
      expect(result.matches[0].records[0]).toMatchObject({
        name: "Alice",
        customer_id: "C001",
      });

      // Secondary entity (orders) should be second
      expect(result.matches[1].entityKey).toBe("orders");
      expect(result.matches[1].isPrimary).toBe(false);
      expect(result.matches[1].records).toHaveLength(2); // C001 has 2 orders
    });

    it("should return empty matches for a linkValue with no hits", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      const result = AnalyticsService.resolveIdentity({
        entityGroupName: "Customer Identity",
        linkValue: "C999",
        stationId: STATION_ID,
        entityGroups: ENTITY_GROUPS,
      });

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].records).toHaveLength(0);
      expect(result.matches[1].records).toHaveLength(0);
    });

    it("should throw for a non-existent entityGroupName", async () => {
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);

      expect(() =>
        AnalyticsService.resolveIdentity({
          entityGroupName: "Nonexistent Group",
          linkValue: "C001",
          stationId: STATION_ID,
          entityGroups: ENTITY_GROUPS,
        })
      ).toThrow("Entity group not found: Nonexistent Group");
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

    it("should annualize when requested", () => {
      const plain = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
      });

      const annualized = AnalyticsService.sharpeRatio({
        records: NUMERIC_RECORDS,
        valueColumn: "val",
        annualize: true,
      });

      // Annualized should be larger in magnitude (multiplied by √252)
      expect(Math.abs(annualized.sharpeRatio)).toBeGreaterThan(
        Math.abs(plain.sharpeRatio)
      );
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

  describe("batch cache methods", () => {
    beforeEach(async () => {
      AnalyticsService.cleanup(STATION_ID);
      setupLoadStationMocks();
      await AnalyticsService.loadStation(STATION_ID, ORG_ID);
    });

    describe("applyRecordInsertMany", () => {
      it("inserts multiple rows in a single call", () => {
        const rows = [
          {
            _record_id: "r-new-1",
            _connector_entity_id: "ent-1",
            name: "Dave",
          },
          { _record_id: "r-new-2", _connector_entity_id: "ent-1", name: "Eve" },
          {
            _record_id: "r-new-3",
            _connector_entity_id: "ent-1",
            name: "Frank",
          },
        ];
        AnalyticsService.applyRecordInsertMany(STATION_ID, "customers", rows);

        const result = AnalyticsService.sqlQuery({
          sql: "SELECT * FROM customers WHERE _record_id IN ('r-new-1','r-new-2','r-new-3')",
          stationId: STATION_ID,
        });
        expect(result).toHaveLength(3);
      });

      it("is a no-op when rows array is empty", () => {
        AnalyticsService.applyRecordInsertMany(STATION_ID, "customers", []);
        // Should not throw
      });
    });

    describe("applyRecordUpdateMany", () => {
      it("replaces existing rows by record ID", () => {
        // Insert rows first
        AnalyticsService.applyRecordInsert(STATION_ID, "customers", {
          _record_id: "r-up-1",
          _connector_entity_id: "ent-1",
          name: "Old",
        });
        AnalyticsService.applyRecordInsert(STATION_ID, "customers", {
          _record_id: "r-up-2",
          _connector_entity_id: "ent-1",
          name: "Old",
        });

        // Batch update
        AnalyticsService.applyRecordUpdateMany(STATION_ID, "customers", [
          { _record_id: "r-up-1", _connector_entity_id: "ent-1", name: "New1" },
          { _record_id: "r-up-2", _connector_entity_id: "ent-1", name: "New2" },
        ]);

        const result = AnalyticsService.sqlQuery({
          sql: "SELECT * FROM customers WHERE _record_id IN ('r-up-1','r-up-2')",
          stationId: STATION_ID,
        });
        expect(result).toHaveLength(2);
        expect((result[0] as any).name).toBe("New1");
        expect((result[1] as any).name).toBe("New2");
      });
    });

    describe("applyRecordDeleteMany", () => {
      it("removes multiple rows by ID", () => {
        // Use orders table to avoid loadStation data conflicts with customers
        AnalyticsService.applyRecordInsert(STATION_ID, "orders", {
          _record_id: "r-del-1",
          _connector_entity_id: "ent-2",
          name: "A",
        });
        AnalyticsService.applyRecordInsert(STATION_ID, "orders", {
          _record_id: "r-del-2",
          _connector_entity_id: "ent-2",
          name: "B",
        });
        AnalyticsService.applyRecordInsert(STATION_ID, "orders", {
          _record_id: "r-del-3",
          _connector_entity_id: "ent-2",
          name: "C",
        });

        AnalyticsService.applyRecordDeleteMany(STATION_ID, "orders", [
          "r-del-1",
          "r-del-2",
        ]);

        const result = AnalyticsService.sqlQuery({
          sql: "SELECT * FROM orders WHERE _record_id IN ('r-del-1','r-del-2','r-del-3')",
          stationId: STATION_ID,
        });
        expect(result).toHaveLength(1);
        expect((result[0] as any)._record_id).toBe("r-del-3");
      });
    });

    describe("applyFieldMappingInsertMany", () => {
      it("inserts multiple field mappings", () => {
        const rows = [
          {
            id: "fm-new-1",
            connector_entity_id: "ent-1",
            column_definition_id: "cd-1",
            source_field: "A",
            is_primary_key: false,
          },
          {
            id: "fm-new-2",
            connector_entity_id: "ent-1",
            column_definition_id: "cd-2",
            source_field: "B",
            is_primary_key: true,
          },
        ];
        AnalyticsService.applyFieldMappingInsertMany(STATION_ID, rows);

        const result = AnalyticsService.sqlQuery({
          sql: "SELECT * FROM _field_mappings WHERE id IN ('fm-new-1','fm-new-2')",
          stationId: STATION_ID,
        });
        expect(result).toHaveLength(2);
      });
    });

    describe("applyFieldMappingDeleteMany", () => {
      it("deletes multiple field mappings", () => {
        AnalyticsService.applyFieldMappingInsert(STATION_ID, {
          id: "fm-d-1",
          connector_entity_id: "ent-1",
          column_definition_id: "cd-1",
          source_field: "X",
          is_primary_key: false,
        });
        AnalyticsService.applyFieldMappingInsert(STATION_ID, {
          id: "fm-d-2",
          connector_entity_id: "ent-1",
          column_definition_id: "cd-2",
          source_field: "Y",
          is_primary_key: false,
        });

        AnalyticsService.applyFieldMappingDeleteMany(STATION_ID, [
          "fm-d-1",
          "fm-d-2",
        ]);

        const result = AnalyticsService.sqlQuery({
          sql: "SELECT * FROM _field_mappings WHERE id IN ('fm-d-1','fm-d-2')",
          stationId: STATION_ID,
        });
        expect(result).toHaveLength(0);
      });
    });

    describe("applyEntityInsertMany", () => {
      it("inserts multiple connector entities", () => {
        const rows = [
          {
            id: "ent-new-1",
            key: "batch_entity_1",
            label: "BE1",
            connectorInstanceId: "ci-1",
          },
          {
            id: "ent-new-2",
            key: "batch_entity_2",
            label: "BE2",
            connectorInstanceId: "ci-1",
          },
        ];
        AnalyticsService.applyEntityInsertMany(STATION_ID, rows);

        const result = AnalyticsService.sqlQuery({
          sql: "SELECT * FROM _connector_entities WHERE id IN ('ent-new-1','ent-new-2')",
          stationId: STATION_ID,
        });
        expect(result).toHaveLength(2);
      });
    });

    describe("applyEntityDeleteMany", () => {
      it("deletes multiple connector entities and their data tables", () => {
        AnalyticsService.applyEntityInsert(STATION_ID, {
          id: "ent-d-1",
          key: "del_ent_1",
          label: "DE1",
          connectorInstanceId: "ci-1",
        });
        AnalyticsService.applyEntityInsert(STATION_ID, {
          id: "ent-d-2",
          key: "del_ent_2",
          label: "DE2",
          connectorInstanceId: "ci-1",
        });

        AnalyticsService.applyEntityDeleteMany(
          STATION_ID,
          ["ent-d-1", "ent-d-2"],
          ["del_ent_1", "del_ent_2"]
        );

        const result = AnalyticsService.sqlQuery({
          sql: "SELECT * FROM _connector_entities WHERE id IN ('ent-d-1','ent-d-2')",
          stationId: STATION_ID,
        });
        expect(result).toHaveLength(0);
      });
    });
  });
});
