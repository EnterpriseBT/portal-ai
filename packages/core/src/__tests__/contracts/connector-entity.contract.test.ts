import {
  ConnectorEntityListRequestQuerySchema,
  ConnectorEntityListResponsePayloadSchema,
  ConnectorEntityGetResponsePayloadSchema,
  ConnectorEntityCreateRequestBodySchema,
  ConnectorEntityCreateResponsePayloadSchema,
} from "../../contracts/connector-entity.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validConnectorEntity = {
  id: "ce-1",
  connectorInstanceId: "ci-1",
  key: "contacts",
  label: "Contacts",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── List request query ───────────────────────────────────────────────

describe("ConnectorEntityListRequestQuerySchema", () => {
  it("should accept a valid query with connectorInstanceId", () => {
    const result = ConnectorEntityListRequestQuerySchema.safeParse({
      connectorInstanceId: "ci-1",
    });
    expect(result.success).toBe(true);
  });

  it("should apply pagination defaults", () => {
    const result = ConnectorEntityListRequestQuerySchema.parse({
      connectorInstanceId: "ci-1",
    });
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sortBy).toBe("created");
    expect(result.sortOrder).toBe("asc");
  });

  it("should reject missing connectorInstanceId", () => {
    const result = ConnectorEntityListRequestQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should cap limit at 100", () => {
    const result = ConnectorEntityListRequestQuerySchema.parse({
      connectorInstanceId: "ci-1",
      limit: "999",
    });
    expect(result.limit).toBe(100);
  });

  it("should accept search, sortBy, and sortOrder", () => {
    const result = ConnectorEntityListRequestQuerySchema.parse({
      connectorInstanceId: "ci-1",
      search: "contacts",
      sortBy: "key",
      sortOrder: "desc",
    });
    expect(result.search).toBe("contacts");
    expect(result.sortBy).toBe("key");
    expect(result.sortOrder).toBe("desc");
  });
});

// ── List response ────────────────────────────────────────────────────

describe("ConnectorEntityListResponsePayloadSchema", () => {
  it("should accept a valid response payload", () => {
    const result = ConnectorEntityListResponsePayloadSchema.safeParse({
      total: 1,
      limit: 20,
      offset: 0,
      connectorEntities: [validConnectorEntity],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty array", () => {
    const result = ConnectorEntityListResponsePayloadSchema.safeParse({
      total: 0,
      limit: 20,
      offset: 0,
      connectorEntities: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing pagination fields", () => {
    const result = ConnectorEntityListResponsePayloadSchema.safeParse({
      connectorEntities: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── Get response ─────────────────────────────────────────────────────

describe("ConnectorEntityGetResponsePayloadSchema", () => {
  it("should accept a valid get response", () => {
    const result = ConnectorEntityGetResponsePayloadSchema.safeParse({
      connectorEntity: validConnectorEntity,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing connectorEntity", () => {
    const result = ConnectorEntityGetResponsePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── Create request body ──────────────────────────────────────────────

describe("ConnectorEntityCreateRequestBodySchema", () => {
  it("should accept a valid create body", () => {
    const result = ConnectorEntityCreateRequestBodySchema.safeParse({
      connectorInstanceId: "ci-1",
      key: "contacts",
      label: "Contacts",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing connectorInstanceId", () => {
    const result = ConnectorEntityCreateRequestBodySchema.safeParse({
      key: "contacts",
      label: "Contacts",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing key", () => {
    const result = ConnectorEntityCreateRequestBodySchema.safeParse({
      connectorInstanceId: "ci-1",
      label: "Contacts",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid key format", () => {
    const result = ConnectorEntityCreateRequestBodySchema.safeParse({
      connectorInstanceId: "ci-1",
      key: "Invalid-Key",
      label: "Contacts",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty label", () => {
    const result = ConnectorEntityCreateRequestBodySchema.safeParse({
      connectorInstanceId: "ci-1",
      key: "contacts",
      label: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── Create response ──────────────────────────────────────────────────

describe("ConnectorEntityCreateResponsePayloadSchema", () => {
  it("should accept a valid create response", () => {
    const result = ConnectorEntityCreateResponsePayloadSchema.safeParse({
      connectorEntity: validConnectorEntity,
    });
    expect(result.success).toBe(true);
  });
});
