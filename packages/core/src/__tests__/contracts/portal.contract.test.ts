import {
  CreatePortalBodySchema,
  SendMessageBodySchema,
  PinResultBodySchema,
  PortalMessageResponseSchema,
  PortalBlockTypeSchema,
  PINNABLE_BLOCK_TYPES,
  D3TreeNodeSchema,
  D3TreeContentBlockSchema,
  DeltaEventSchema,
  ToolResultEventSchema,
  DoneEventSchema,
  PortalListResponsePayloadSchema,
} from "../../contracts/portal.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validPortal = {
  id: "p-1",
  organizationId: "org-1",
  stationId: "st-1",
  name: "Portal — 2026-03-25",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── CreatePortalBodySchema ──────────────────────────────────────────

describe("CreatePortalBodySchema", () => {
  it("should accept valid input", () => {
    const result = CreatePortalBodySchema.safeParse({ stationId: "st-1" });
    expect(result.success).toBe(true);
  });

  it("should reject missing stationId", () => {
    const result = CreatePortalBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject empty stationId", () => {
    const result = CreatePortalBodySchema.safeParse({ stationId: "" });
    expect(result.success).toBe(false);
  });
});

// ── SendMessageBodySchema ───────────────────────────────────────────

describe("SendMessageBodySchema", () => {
  it("should accept valid input", () => {
    const result = SendMessageBodySchema.safeParse({ message: "hello" });
    expect(result.success).toBe(true);
  });

  it("should reject missing message", () => {
    const result = SendMessageBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject empty message", () => {
    const result = SendMessageBodySchema.safeParse({ message: "" });
    expect(result.success).toBe(false);
  });
});

// ── PinResultBodySchema ─────────────────────────────────────────────

describe("PinResultBodySchema", () => {
  it("should accept valid input", () => {
    const result = PinResultBodySchema.safeParse({
      portalId: "p-1",
      blockIndex: 0,
      name: "My Pin",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing fields", () => {
    const result = PinResultBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject negative blockIndex", () => {
    const result = PinResultBodySchema.safeParse({
      portalId: "p-1",
      blockIndex: -1,
      name: "My Pin",
    });
    expect(result.success).toBe(false);
  });

  it("should reject non-integer blockIndex", () => {
    const result = PinResultBodySchema.safeParse({
      portalId: "p-1",
      blockIndex: 1.5,
      name: "My Pin",
    });
    expect(result.success).toBe(false);
  });
});

// ── PortalMessageResponseSchema ─────────────────────────────────────

describe("PortalMessageResponseSchema", () => {
  const validMessage = {
    id: "m-1",
    portalId: "p-1",
    organizationId: "org-1",
    role: "user",
    blocks: [{ type: "text", content: "hello" }],
    created: Date.now(),
  };

  it("should accept a valid message object", () => {
    const result = PortalMessageResponseSchema.safeParse(validMessage);
    expect(result.success).toBe(true);
  });

  it("should accept role 'user'", () => {
    const result = PortalMessageResponseSchema.safeParse({
      ...validMessage,
      role: "user",
    });
    expect(result.success).toBe(true);
  });

  it("should accept role 'assistant'", () => {
    const result = PortalMessageResponseSchema.safeParse({
      ...validMessage,
      role: "assistant",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid role", () => {
    const result = PortalMessageResponseSchema.safeParse({
      ...validMessage,
      role: "system",
    });
    expect(result.success).toBe(false);
  });
});

// ── PortalBlockTypeSchema ────────────────────────────────────────────

describe("PortalBlockTypeSchema", () => {
  it("should accept \"vega\" as a valid block type", () => {
    const result = PortalBlockTypeSchema.safeParse("vega");
    expect(result.success).toBe(true);
  });

  it("should accept \"d3-tree\" as a valid block type", () => {
    const result = PortalBlockTypeSchema.safeParse("d3-tree");
    expect(result.success).toBe(true);
  });
});

// ── PINNABLE_BLOCK_TYPES ────────────────────────────────────────────

describe("PINNABLE_BLOCK_TYPES", () => {
  it("should contain \"vega\"", () => {
    expect(PINNABLE_BLOCK_TYPES.has("vega")).toBe(true);
  });

  it("should contain \"d3-tree\"", () => {
    expect(PINNABLE_BLOCK_TYPES.has("d3-tree")).toBe(true);
  });
});

// ── D3TreeNodeSchema ────────────────────────────────────────────────

describe("D3TreeNodeSchema", () => {
  it("should accept valid tree data", () => {
    const result = D3TreeNodeSchema.safeParse({
      name: "Root",
      attributes: { role: "CEO" },
      children: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing name", () => {
    const result = D3TreeNodeSchema.safeParse({
      attributes: {},
      children: [],
    });
    expect(result.success).toBe(false);
  });

  it("should accept nested children recursively", () => {
    const result = D3TreeNodeSchema.safeParse({
      name: "Root",
      children: [
        {
          name: "Child A",
          children: [
            { name: "Grandchild A1" },
          ],
        },
        { name: "Child B" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should accept node without optional fields", () => {
    const result = D3TreeNodeSchema.safeParse({ name: "Leaf" });
    expect(result.success).toBe(true);
  });
});

// ── D3TreeContentBlockSchema ────────────────────────────────────────

describe("D3TreeContentBlockSchema", () => {
  it("should accept valid d3-tree content block", () => {
    const result = D3TreeContentBlockSchema.safeParse({
      type: "d3-tree",
      content: { name: "Root", children: [] },
    });
    expect(result.success).toBe(true);
  });

  it("should reject wrong type literal", () => {
    const result = D3TreeContentBlockSchema.safeParse({
      type: "vega",
      content: { name: "Root" },
    });
    expect(result.success).toBe(false);
  });
});

// ── DeltaEventSchema ────────────────────────────────────────────────

describe("DeltaEventSchema", () => {
  it("should accept valid delta event", () => {
    const result = DeltaEventSchema.safeParse({
      type: "delta",
      content: "text",
    });
    expect(result.success).toBe(true);
  });

  it("should reject wrong type", () => {
    const result = DeltaEventSchema.safeParse({
      type: "done",
      content: "text",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing content", () => {
    const result = DeltaEventSchema.safeParse({ type: "delta" });
    expect(result.success).toBe(false);
  });
});

// ── ToolResultEventSchema ───────────────────────────────────────────

describe("ToolResultEventSchema", () => {
  it("should accept valid tool result event", () => {
    const result = ToolResultEventSchema.safeParse({
      type: "tool_result",
      toolName: "sql_query",
      result: { rows: [], columns: [] },
    });
    expect(result.success).toBe(true);
  });

  it("should reject wrong type", () => {
    const result = ToolResultEventSchema.safeParse({
      type: "delta",
      toolName: "sql_query",
      result: {},
    });
    expect(result.success).toBe(false);
  });
});

// ── DoneEventSchema ─────────────────────────────────────────────────

describe("DoneEventSchema", () => {
  it("should accept valid done event", () => {
    const result = DoneEventSchema.safeParse({
      type: "done",
      portalId: "p-1",
      messageId: "m-1",
    });
    expect(result.success).toBe(true);
  });

  it("should reject wrong type", () => {
    const result = DoneEventSchema.safeParse({
      type: "delta",
      portalId: "p-1",
      messageId: "m-1",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing fields", () => {
    const result = DoneEventSchema.safeParse({ type: "done" });
    expect(result.success).toBe(false);
  });
});

// ── PortalListResponsePayloadSchema ─────────────────────────────────

describe("PortalListResponsePayloadSchema", () => {
  it("should accept a valid response with portals array", () => {
    const result = PortalListResponsePayloadSchema.safeParse({
      total: 1,
      limit: 20,
      offset: 0,
      portals: [validPortal],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty portals array", () => {
    const result = PortalListResponsePayloadSchema.safeParse({
      total: 0,
      limit: 20,
      offset: 0,
      portals: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing pagination fields", () => {
    const result = PortalListResponsePayloadSchema.safeParse({
      portals: [],
    });
    expect(result.success).toBe(false);
  });
});
