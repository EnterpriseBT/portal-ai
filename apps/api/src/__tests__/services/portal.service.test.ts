/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks — must be registered before any dynamic imports
// ---------------------------------------------------------------------------

// DB Service
const mockFindById_station = jest.fn<() => Promise<unknown>>();
const mockFindById_portal = jest.fn<() => Promise<unknown>>();
const mockCreate_portal = jest.fn<() => Promise<unknown>>();
const mockCreate_message = jest.fn<() => Promise<unknown>>();
const mockFindByPortal = jest.fn<() => Promise<unknown[]>>();
const mockDeleteByPortal = jest.fn<() => Promise<number>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      stations: { findById: mockFindById_station },
      portals: {
        findById: mockFindById_portal,
        create: mockCreate_portal,
      },
      portalMessages: {
        findByPortal: mockFindByPortal,
        create: mockCreate_message,
        deleteByPortal: mockDeleteByPortal,
      },
    },
  },
}));

// AnalyticsService
const mockLoadStation = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { loadStation: mockLoadStation },
}));

// buildAnalyticsTools
const mockBuildAnalyticsTools = jest.fn<() => Promise<Record<string, unknown>>>();

jest.unstable_mockModule("../../services/analytics.tools.js", () => ({
  buildAnalyticsTools: mockBuildAnalyticsTools,
}));

// AiService
const mockStreamText = jest.fn<() => unknown>();

jest.unstable_mockModule("ai", () => ({
  streamText: mockStreamText,
  stepCountIs: jest.fn(() => ({})),
}));

jest.unstable_mockModule("../../services/ai.service.js", () => ({
  AiService: {
    DEFAULT_MODEL: "claude-sonnet-4-20250514",
    providers: {
      anthropic: jest.fn(() => "mock-model"),
    },
  },
}));

// SystemUtilities
let _idCounter = 0;
jest.unstable_mockModule("../../utils/system.util.js", () => ({
  SystemUtilities: {
    id: {
      v4: { generate: jest.fn(() => `generated-id-${++_idCounter}`) },
    },
    utc: {
      now: jest.fn(() => ({ getTime: () => 1742860800000 })),
      format: jest.fn(() => "Mar 25, 2026"),
    },
  },
}));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks)
// ---------------------------------------------------------------------------

const { PortalService } = await import("../../services/portal.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = "org-001";
const STATION_ID = "station-001";
const PORTAL_ID = "portal-001";
const USER_ID = "user-001";

const STATION = {
  id: STATION_ID,
  organizationId: ORG_ID,
  name: "Sales Station",
  toolPacks: ["data_query", "statistics"],
};

const PORTAL = {
  id: PORTAL_ID,
  organizationId: ORG_ID,
  stationId: STATION_ID,
  name: "Portal — Mar 25, 2026",
  createdBy: USER_ID,
};

const ENTITIES = [
  {
    id: "ent-1",
    key: "customers",
    label: "Customers",
    connectorInstanceId: "ci-1",
    columns: [
      { key: "id", label: "ID", type: "string" },
      { key: "revenue", label: "Revenue", type: "number" },
    ],
  },
  {
    id: "ent-2",
    key: "orders",
    label: "Orders",
    connectorInstanceId: "ci-1",
    columns: [{ key: "customer_id", label: "Customer ID", type: "string" }],
  },
];

const ENTITY_GROUPS = [
  {
    id: "group-1",
    name: "Customer Orders",
    members: [
      {
        entityKey: "customers",
        linkColumnKey: "id",
        linkColumnLabel: "ID",
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

const STATION_DATA = {
  entities: ENTITIES,
  entityGroups: ENTITY_GROUPS,
  records: new Map(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an async generator that yields the given chunks. */
async function* makeStream(
  chunks: Record<string, unknown>[]
): AsyncGenerator<Record<string, unknown>> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/** Build a mock SseUtil. */
function makeSse() {
  return {
    send: jest.fn(),
    end: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PortalService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _idCounter = 0;
  });

  // ── createPortal ─────────────────────────────────────────────────────────

  describe("createPortal", () => {
    it("returns portalId and stationContext on success", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockCreate_portal.mockResolvedValue(PORTAL);
      mockLoadStation.mockResolvedValue(STATION_DATA);

      const result = await PortalService.createPortal({
        stationId: STATION_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(result.portalId).toBe(PORTAL_ID);
      expect(result.stationContext.stationId).toBe(STATION_ID);
      expect(result.stationContext.stationName).toBe("Sales Station");
      expect(result.stationContext.entities).toBe(ENTITIES);
      expect(result.stationContext.entityGroups).toBe(ENTITY_GROUPS);
    });

    it("calls loadStation and caches result", async () => {
      mockFindById_station.mockResolvedValue(STATION);
      mockCreate_portal.mockResolvedValue(PORTAL);
      mockLoadStation.mockResolvedValue(STATION_DATA);

      await PortalService.createPortal({
        stationId: STATION_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(mockLoadStation).toHaveBeenCalledWith(STATION_ID, ORG_ID);
    });

    it("throws STATION_NOT_FOUND when station does not exist", async () => {
      mockFindById_station.mockResolvedValue(null);

      await expect(
        PortalService.createPortal({
          stationId: STATION_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ code: ApiCode.STATION_NOT_FOUND });
    });

    it("throws STATION_NOT_FOUND when station belongs to a different org", async () => {
      mockFindById_station.mockResolvedValue({
        ...STATION,
        organizationId: "other-org",
      });

      await expect(
        PortalService.createPortal({
          stationId: STATION_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ code: ApiCode.STATION_NOT_FOUND });
    });

    it("throws PORTAL_STATION_NO_TOOLS when station has no tool packs", async () => {
      mockFindById_station.mockResolvedValue({
        ...STATION,
        toolPacks: [],
      });

      await expect(
        PortalService.createPortal({
          stationId: STATION_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ code: ApiCode.PORTAL_STATION_NO_TOOLS });
    });

    it("throws PORTAL_STATION_NO_TOOLS when toolPacks is null", async () => {
      mockFindById_station.mockResolvedValue({
        ...STATION,
        toolPacks: null,
      });

      await expect(
        PortalService.createPortal({
          stationId: STATION_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ code: ApiCode.PORTAL_STATION_NO_TOOLS });
    });
  });

  // ── getPortal ─────────────────────────────────────────────────────────────

  describe("getPortal", () => {
    it("returns portal, messages, and coreMessages", async () => {
      const messages = [{ id: "msg-1", role: "user", blocks: [{ type: "text", content: "Hi" }] }];
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockFindByPortal.mockResolvedValue(messages);

      const result = await PortalService.getPortal(PORTAL_ID);

      expect(result.portal).toBe(PORTAL);
      expect(result.messages).toBe(messages);
      expect(result.coreMessages).toBeDefined();
      expect(mockFindByPortal).toHaveBeenCalledWith(PORTAL_ID);
    });

    it("reconstructs full ModelMessage[] including tool turns", async () => {
      const messages = [
        {
          id: "msg-1",
          role: "user",
          blocks: [{ type: "text", content: "Show me revenue" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          blocks: [
            { type: "text", content: "Let me query that." },
            { type: "tool-call", toolCallId: "tc-1", toolName: "sql_query", args: { query: "SELECT *" } },
            { type: "tool-result", toolCallId: "tc-1", toolName: "sql_query", content: { rows: [{ id: 1 }] } },
            { type: "data-table", columns: ["id"], rows: [{ id: 1 }] },
            { type: "text", content: "Here are the results." },
          ],
        },
      ];
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockFindByPortal.mockResolvedValue(messages);

      const result = await PortalService.getPortal(PORTAL_ID);

      // User message
      expect(result.coreMessages[0]).toEqual({
        role: "user",
        content: "Show me revenue",
      });

      // Assistant message with text + tool-call parts
      expect(result.coreMessages[1]).toEqual({
        role: "assistant",
        content: [
          { type: "text", text: "Let me query that." },
          { type: "tool-call", toolCallId: "tc-1", toolName: "sql_query", args: { query: "SELECT *" } },
          { type: "text", text: "Here are the results." },
        ],
      });

      // Tool results message
      expect(result.coreMessages[2]).toEqual({
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "tc-1", toolName: "sql_query", result: { rows: [{ id: 1 }] } },
        ],
      });
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist", async () => {
      mockFindById_portal.mockResolvedValue(null);

      await expect(PortalService.getPortal(PORTAL_ID)).rejects.toMatchObject({
        code: ApiCode.PORTAL_NOT_FOUND,
      });
    });
  });

  // ── addMessage ────────────────────────────────────────────────────────────

  describe("addMessage", () => {
    it("persists a user message as a text block", async () => {
      const savedMsg = { id: "msg-new", role: "user", blocks: [] };
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockCreate_message.mockResolvedValue(savedMsg);

      const result = await PortalService.addMessage(PORTAL_ID, {
        role: "user",
        content: "Hello!",
      });

      expect(result).toBe(savedMsg);
      expect(mockCreate_message).toHaveBeenCalledWith(
        expect.objectContaining({
          portalId: PORTAL_ID,
          organizationId: ORG_ID,
          role: "user",
          blocks: [{ type: "text", content: "Hello!" }],
        })
      );
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist", async () => {
      mockFindById_portal.mockResolvedValue(null);

      await expect(
        PortalService.addMessage(PORTAL_ID, { role: "user", content: "hi" })
      ).rejects.toMatchObject({ code: ApiCode.PORTAL_NOT_FOUND });
    });
  });

  // ── resetPortal ──────────────────────────────────────────────────────────

  describe("resetPortal", () => {
    it("deletes all messages and returns count", async () => {
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockDeleteByPortal.mockResolvedValue(5);

      const count = await PortalService.resetPortal(PORTAL_ID);

      expect(count).toBe(5);
      expect(mockDeleteByPortal).toHaveBeenCalledWith(PORTAL_ID);
    });

    it("returns 0 when portal has no messages", async () => {
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockDeleteByPortal.mockResolvedValue(0);

      const count = await PortalService.resetPortal(PORTAL_ID);

      expect(count).toBe(0);
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist", async () => {
      mockFindById_portal.mockResolvedValue(null);

      await expect(PortalService.resetPortal(PORTAL_ID)).rejects.toMatchObject({
        code: ApiCode.PORTAL_NOT_FOUND,
      });
    });
  });

  // ── streamResponse ────────────────────────────────────────────────────────

  describe("streamResponse", () => {
    const stationContext = {
      stationId: STATION_ID,
      stationName: "Sales Station",
      entities: ENTITIES,
      entityGroups: [],
    };

    const stationContextWithGroups = {
      ...stationContext,
      entityGroups: ENTITY_GROUPS,
    };

    beforeEach(() => {
      mockBuildAnalyticsTools.mockResolvedValue({});
      mockFindById_portal.mockResolvedValue(PORTAL);
      mockCreate_message.mockResolvedValue({ id: "msg-assistant" });
    });

    it("streams delta events and sends done on completion", async () => {
      const chunks = [
        { type: "text-delta", text: "Hello " },
        { type: "text-delta", text: "world" },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [{ role: "user", content: "hi" }],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(sse.send).toHaveBeenCalledWith("delta", {
        type: "delta",
        content: "Hello ",
      });
      expect(sse.send).toHaveBeenCalledWith("delta", {
        type: "delta",
        content: "world",
      });
      expect(sse.send).toHaveBeenCalledWith("done", {
        type: "done",
        portalId: PORTAL_ID,
        messageId: "msg-assistant",
      });
    });

    it("sends tool_result SSE event for visualize tool", async () => {
      const vegaResult = { rows: [], spec: { mark: "bar" } };
      const chunks = [
        {
          type: "tool-result",
          toolName: "visualize",
          output: vegaResult,
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(sse.send).toHaveBeenCalledWith("tool_result", {
        type: "tool_result",
        toolName: "visualize",
        result: vegaResult,
      });
    });

    it("sends tool_result SSE event for webhook tool returning vega-lite", async () => {
      const vegaResult = { type: "vega-lite", spec: { mark: "line" } };
      const chunks = [
        {
          type: "tool-result",
          toolName: "my_webhook_tool",
          output: vegaResult,
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(sse.send).toHaveBeenCalledWith("tool_result", {
        type: "tool_result",
        toolName: "my_webhook_tool",
        result: vegaResult,
      });
    });

    it("sends tool_result SSE event for visualize_tree tool", async () => {
      const vegaResult = { data: [{ values: [] }], marks: [{ type: "rect" }] };
      const chunks = [
        {
          type: "tool-result",
          toolName: "visualize_tree",
          output: vegaResult,
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(sse.send).toHaveBeenCalledWith("tool_result", {
        type: "tool_result",
        toolName: "visualize_tree",
        result: vegaResult,
      });
    });

    it("sends tool_result SSE event for webhook tool returning vega type", async () => {
      const vegaResult = { type: "vega", data: [{ values: [] }] };
      const chunks = [
        {
          type: "tool-result",
          toolName: "my_webhook_tool",
          output: vegaResult,
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(sse.send).toHaveBeenCalledWith("tool_result", {
        type: "tool_result",
        toolName: "my_webhook_tool",
        result: vegaResult,
      });
    });

    it("persists vega display block in assistant message", async () => {
      const vegaResult = { data: [{ values: [] }], marks: [] };
      const chunks = [
        { type: "tool-call", toolCallId: "tc-v", toolName: "visualize_tree", args: {} },
        { type: "tool-result", toolCallId: "tc-v", toolName: "visualize_tree", output: vegaResult },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(mockCreate_message).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            { type: "vega", content: vegaResult },
          ]),
        })
      );
    });

    it("sends data-table SSE event for sql_query tool results", async () => {
      const queryResult = { rows: [{ id: 1, name: "Alice" }] };
      const chunks = [
        {
          type: "tool-result",
          toolName: "sql_query",
          toolCallId: "tc-1",
          output: queryResult,
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      const toolResultCalls = (sse.send as any).mock.calls.filter(
        (c: unknown[]) => c[0] === "tool_result"
      );
      expect(toolResultCalls).toHaveLength(1);
      expect(toolResultCalls[0][1]).toMatchObject({
        type: "tool_result",
        toolName: "sql_query",
        result: {
          type: "data-table",
          columns: ["id", "name"],
          rows: [{ id: 1, name: "Alice" }],
        },
      });
    });

    it("sends data-table SSE event for detect_outliers tool results", async () => {
      const outlierResult = { rows: [{ value: 99, is_outlier: true }] };
      const chunks = [
        {
          type: "tool-result",
          toolName: "detect_outliers",
          toolCallId: "tc-2",
          output: outlierResult,
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      const toolResultCalls = (sse.send as any).mock.calls.filter(
        (c: unknown[]) => c[0] === "tool_result"
      );
      expect(toolResultCalls).toHaveLength(1);
      expect(toolResultCalls[0][1].result.type).toBe("data-table");
    });

    it("does not send tool_result SSE for scalar tool results (correlate)", async () => {
      const chunks = [
        {
          type: "tool-result",
          toolName: "correlate",
          toolCallId: "tc-3",
          output: { coefficient: 0.87 },
        },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      const toolResultCalls = (sse.send as any).mock.calls.filter(
        (c: unknown[]) => c[0] === "tool_result"
      );
      expect(toolResultCalls).toHaveLength(0);
    });

    it("persists assistant message with tool-call, tool-result, and display blocks", async () => {
      const chunks = [
        { type: "text-delta", text: "Analysis: " },
        { type: "tool-call", toolCallId: "tc-1", toolName: "visualize", args: { type: "bar" } },
        { type: "tool-result", toolCallId: "tc-1", toolName: "visualize", output: { chart: true } },
        { type: "text-delta", text: "done" },
        { type: "finish" },
      ];
      mockStreamText.mockReturnValue({ fullStream: makeStream(chunks) });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(mockCreate_message).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          blocks: [
            { type: "text", content: "Analysis: " },
            { type: "tool-call", toolCallId: "tc-1", toolName: "visualize", args: { type: "bar" } },
            { type: "tool-result", toolCallId: "tc-1", toolName: "visualize", content: { chart: true } },
            { type: "vega-lite", content: { chart: true } },
            { type: "text", content: "done" },
          ],
        })
      );
    });

    // ── system prompt: no entity groups ──────────────────────────────────────

    it("system prompt does NOT include Cross-Entity Relationships when entityGroups is empty", async () => {
      mockStreamText.mockReturnValue({ fullStream: makeStream([{ type: "finish" }]) });

      let capturedSystem: string | undefined;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedSystem = opts.system;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext, // entityGroups: []
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(capturedSystem).not.toContain("Cross-Entity Relationships");
    });

    // ── system prompt: with entity groups ────────────────────────────────────

    it("system prompt includes Cross-Entity Relationships when entityGroups is non-empty", async () => {
      let capturedSystem: string | undefined;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedSystem = opts.system;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext: stationContextWithGroups,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(capturedSystem).toContain("Cross-Entity Relationships");
    });

    it("system prompt Entity Group section lists member entities and link columns", async () => {
      let capturedSystem: string | undefined;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedSystem = opts.system;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext: stationContextWithGroups,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(capturedSystem).toContain("Customer Orders");
      expect(capturedSystem).toContain("`customers`");
      expect(capturedSystem).toContain("link column: `id`");
      expect(capturedSystem).toContain("[primary]");
      expect(capturedSystem).toContain("`orders`");
      expect(capturedSystem).toContain("link column: `customer_id`");
    });

    it("system prompt includes entity schemas", async () => {
      let capturedSystem: string | undefined;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedSystem = opts.system;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(capturedSystem).toContain("Sales Station");
      expect(capturedSystem).toContain("Customers");
      expect(capturedSystem).toContain("`customers`");
      expect(capturedSystem).toContain("`revenue`");
      expect(capturedSystem).toContain("Orders");
    });

    it("calls buildAnalyticsTools with correct args and passes tools to streamText", async () => {
      const tools = { sql_query: {} };
      mockBuildAnalyticsTools.mockResolvedValue(tools);

      let capturedTools: unknown;
      (mockStreamText as any).mockImplementation((opts: any) => {
        capturedTools = opts.tools;
        return { fullStream: makeStream([{ type: "finish" }]) };
      });

      const sse = makeSse();
      await PortalService.streamResponse({
        portalId: PORTAL_ID,
        messages: [],
        stationContext,
        organizationId: ORG_ID,
        sse: sse as any,
      });

      expect(mockBuildAnalyticsTools).toHaveBeenCalledWith(ORG_ID, STATION_ID);
      expect(capturedTools).toBe(tools);
    });

    it("throws PORTAL_NOT_FOUND when portal does not exist at persist time", async () => {
      mockStreamText.mockReturnValue({
        fullStream: makeStream([{ type: "finish" }]),
      });
      mockFindById_portal.mockResolvedValue(null);

      const sse = makeSse();
      await expect(
        PortalService.streamResponse({
          portalId: PORTAL_ID,
          messages: [],
          stationContext,
          organizationId: ORG_ID,
          sse: sse as any,
        })
      ).rejects.toMatchObject({ code: ApiCode.PORTAL_NOT_FOUND });
    });
  });
});
