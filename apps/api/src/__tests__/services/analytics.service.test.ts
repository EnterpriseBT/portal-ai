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
