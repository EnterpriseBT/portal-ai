import {
  StationListRequestQuerySchema,
  StationListResponsePayloadSchema,
  CreateStationBodySchema,
  StationCreateResponsePayloadSchema,
  UpdateStationBodySchema,
  StationUpdateResponsePayloadSchema,
  StationGetResponsePayloadSchema,
} from "../../contracts/station.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validStation = {
  id: "st-1",
  organizationId: "org-1",
  name: "Analytics Station",
  description: "Main workspace",
  enabledToolpacks: ["data_query", "statistics"],
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── List request query ───────────────────────────────────────────────

describe("StationListRequestQuerySchema", () => {
  it("should accept valid pagination + search params", () => {
    const result = StationListRequestQuerySchema.safeParse({
      search: "analytics",
      sortBy: "name",
      sortOrder: "asc",
      limit: "10",
      offset: "0",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe("analytics");
      expect(result.data.sortBy).toBe("name");
    }
  });

  it("should apply defaults", () => {
    const result = StationListRequestQuerySchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sortBy).toBe("created");
    expect(result.sortOrder).toBe("asc");
  });

  it("should cap limit at 100", () => {
    const result = StationListRequestQuerySchema.parse({ limit: "200" });
    expect(result.limit).toBe(100);
  });
});

// ── List response ────────────────────────────────────────────────────

describe("StationListResponsePayloadSchema", () => {
  it("should accept a valid response payload", () => {
    const result = StationListResponsePayloadSchema.safeParse({
      total: 1,
      limit: 20,
      offset: 0,
      stations: [validStation],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty array", () => {
    const result = StationListResponsePayloadSchema.safeParse({
      total: 0,
      limit: 20,
      offset: 0,
      stations: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing pagination fields", () => {
    const result = StationListResponsePayloadSchema.safeParse({
      stations: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── Create request body ──────────────────────────────────────────────

describe("CreateStationBodySchema", () => {
  it("should accept valid input", () => {
    const result = CreateStationBodySchema.safeParse({
      name: "Analytics Station",
      description: "Main workspace",
      connectorInstanceIds: ["ci-1", "ci-2"],
    });
    expect(result.success).toBe(true);
  });

  it("should accept name only", () => {
    const result = CreateStationBodySchema.safeParse({
      name: "Analytics Station",
    });
    expect(result.success).toBe(true);
  });

  it("#674: accepts curatedViewIds beside connectorInstanceIds", () => {
    const result = CreateStationBodySchema.safeParse({
      name: "Analytics Station",
      connectorInstanceIds: ["ci-1"],
      curatedViewIds: ["cv-1", "cv-2"],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.curatedViewIds).toEqual([
      "cv-1",
      "cv-2",
    ]);
  });

  it("should reject empty name", () => {
    const result = CreateStationBodySchema.safeParse({
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing name", () => {
    const result = CreateStationBodySchema.safeParse({
      description: "A station",
    });
    expect(result.success).toBe(false);
  });
});

// ── Create response ──────────────────────────────────────────────────

describe("StationCreateResponsePayloadSchema", () => {
  it("should accept a valid create response", () => {
    const result = StationCreateResponsePayloadSchema.safeParse({
      station: validStation,
    });
    expect(result.success).toBe(true);
  });
});

// ── Update request body ──────────────────────────────────────────────

describe("UpdateStationBodySchema", () => {
  it("should accept partial update with name only", () => {
    const result = UpdateStationBodySchema.safeParse({
      name: "Renamed",
    });
    expect(result.success).toBe(true);
  });

  it("should accept partial update with description only", () => {
    const result = UpdateStationBodySchema.safeParse({
      description: "New desc",
    });
    expect(result.success).toBe(true);
  });

  it("#674: accepts an update carrying only curatedViewIds (it counts toward the refine)", () => {
    expect(
      UpdateStationBodySchema.safeParse({ curatedViewIds: [] }).success
    ).toBe(true);
    expect(
      UpdateStationBodySchema.safeParse({ curatedViewIds: ["cv-1"] }).success
    ).toBe(true);
  });

  it("should reject empty object (at least one field required)", () => {
    const result = UpdateStationBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject empty name", () => {
    const result = UpdateStationBodySchema.safeParse({
      name: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── Update response ──────────────────────────────────────────────────

describe("StationUpdateResponsePayloadSchema", () => {
  it("should accept a valid update response", () => {
    const result = StationUpdateResponsePayloadSchema.safeParse({
      station: validStation,
    });
    expect(result.success).toBe(true);
  });
});

describe("StationGetResponsePayloadSchema (#674)", () => {
  const audit = {
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
  const instance = {
    ...audit,
    id: "si-1",
    stationId: "st-1",
    connectorInstanceId: "ci-1",
  };
  const view = {
    ...audit,
    id: "sv-1",
    organizationId: "org-1",
    stationId: "st-1",
    curatedViewId: "cv-1",
    curatedView: {
      id: "cv-1",
      key: "v_one",
      label: "View one",
      connectorEntityId: "ce-1",
    },
  };
  const payload = (instances: unknown[], views: unknown[]) => ({
    station: { ...validStation, instances, views },
    canShare: false,
    canWrite: true,
    canDelete: false,
  });

  it("accepts instances and views carrying canRead", () => {
    expect(
      StationGetResponsePayloadSchema.safeParse(
        payload([{ ...instance, canRead: true }], [{ ...view, canRead: false }])
      ).success
    ).toBe(true);
  });

  it("accepts an unreadable instance whose connector carries only id and name", () => {
    expect(
      StationGetResponsePayloadSchema.safeParse(
        payload(
          [
            {
              ...instance,
              connectorInstance: { id: "ci-1", name: "HR system" },
              canRead: false,
            },
          ],
          []
        )
      ).success
    ).toBe(true);
  });

  it("requires canRead on every instance and view", () => {
    expect(
      StationGetResponsePayloadSchema.safeParse(payload([instance], [])).success
    ).toBe(false);
    expect(
      StationGetResponsePayloadSchema.safeParse(payload([], [view])).success
    ).toBe(false);
  });
});
