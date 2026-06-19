/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { Consumption } from "@portalai/core/models";

// Capture the body passed to callWebhook; mock the dataset resolver + the
// handle meta + token service the streaming path uses.
const mockCallWebhook = jest.fn<() => Promise<unknown>>();
const mockResolveRecordSource = jest.fn<() => Promise<unknown>>();
const mockGetMeta = jest.fn<() => Promise<unknown>>();
const mockMint = jest.fn<() => Promise<string>>();
const mockRevoke = jest.fn<() => Promise<void>>();

jest.unstable_mockModule("../../services/tools.service.js", () => ({
  ToolService: { callWebhook: mockCallWebhook },
}));
jest.unstable_mockModule("../../tools/record-source.js", () => ({
  resolveRecordSource: mockResolveRecordSource,
}));
jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: { getMeta: mockGetMeta },
}));
jest.unstable_mockModule("../../services/webhook-read-token.service.js", () => ({
  WebhookReadTokenService: { mint: mockMint, revoke: mockRevoke },
}));

const { WebhookTool } = await import("../../tools/webhook.tool.js");

const IMPL = {
  type: "webhook" as const,
  url: "https://hook.example.com/run",
  signingSecret: "secret",
};
const PARAM_SCHEMA = {
  type: "object",
  properties: { factor: { type: "number" } },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exec(t: any, input: Record<string, unknown>) {
  return t.execute(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });
}

function buildTool(consumption?: Consumption, organizationId = "org-1") {
  return new WebhookTool(
    "summarize",
    "Summarize the records.",
    PARAM_SCHEMA,
    IMPL,
    "station-1",
    consumption,
    organizationId
  ).build();
}

describe("WebhookTool — consumption-tiered body (#124)", () => {
  beforeEach(() => {
    mockCallWebhook.mockReset().mockResolvedValue({ ok: true });
    mockResolveRecordSource.mockReset();
    mockGetMeta.mockReset();
    mockMint.mockReset().mockResolvedValue("tok-abc");
    mockRevoke.mockReset().mockResolvedValue(undefined);
  });

  it("none (default): POSTs { tool, input } inline, no records, no source fields", async () => {
    const t = buildTool(); // undefined consumption → inline
    await exec(t, { factor: 2 });

    expect(mockResolveRecordSource).not.toHaveBeenCalled();
    expect(mockCallWebhook).toHaveBeenCalledWith(IMPL, {
      tool: "summarize",
      input: { factor: 2 },
    });
  });

  it("bounded: resolves the dataset and POSTs { tool, input, records }, source fields stripped", async () => {
    const consumption: Consumption = {
      mode: "bounded",
      maxRows: 1000,
      onOverflow: "error",
    };
    mockResolveRecordSource.mockResolvedValue({
      rows: [{ a: 1 }, { a: 2 }],
      total: 2,
      sampled: false,
    });
    const t = buildTool(consumption);

    await exec(t, { factor: 3, queryHandle: "qh-1" });

    // dataset resolved against the declared consumption (the ceiling)
    expect(mockResolveRecordSource).toHaveBeenCalledWith(
      { queryHandle: "qh-1", rows: undefined },
      consumption
    );
    // records carried in the body; queryHandle NOT leaked into `input`
    expect(mockCallWebhook).toHaveBeenCalledWith(IMPL, {
      tool: "summarize",
      input: { factor: 3 },
      records: [{ a: 1 }, { a: 2 }],
    });
  });

  it("bounded: an over-bound onOverflow:error from the resolver propagates", async () => {
    const consumption: Consumption = {
      mode: "bounded",
      maxRows: 1,
      onOverflow: "error",
    };
    mockResolveRecordSource.mockRejectedValue(
      Object.assign(new Error("too large"), { code: "COMPUTE_INPUT_TOO_LARGE" })
    );
    const t = buildTool(consumption);

    await expect(exec(t, { queryHandle: "qh-big" })).rejects.toMatchObject({
      code: "COMPUTE_INPUT_TOO_LARGE",
    });
    expect(mockCallWebhook).not.toHaveBeenCalled();
  });

  it("bounded: accepts inline rows as the dataset source", async () => {
    const consumption: Consumption = {
      mode: "bounded",
      maxRows: 1000,
      onOverflow: "error",
    };
    mockResolveRecordSource.mockResolvedValue({
      rows: [{ a: 9 }],
      total: 1,
      sampled: false,
    });
    const t = buildTool(consumption);

    await exec(t, { factor: 1, rows: [{ a: 9 }] });

    expect(mockResolveRecordSource).toHaveBeenCalledWith(
      { queryHandle: undefined, rows: [{ a: 9 }] },
      consumption
    );
    expect(mockCallWebhook).toHaveBeenCalledWith(IMPL, {
      tool: "summarize",
      input: { factor: 1 },
      records: [{ a: 9 }],
    });
  });

  describe("streaming", () => {
    const streaming: Consumption = { mode: "streaming" };

    it("queryHandle: mints a read token and POSTs a pull-on-read grant, revokes after", async () => {
      mockGetMeta.mockResolvedValue({
        rowCount: 250_000,
        schema: [{ name: "ts", type: "timestamptz" }],
        _organizationId: "org-1",
      });
      const t = buildTool(streaming);

      await exec(t, { factor: 5, queryHandle: "qh-big" });

      expect(mockMint).toHaveBeenCalledWith({
        organizationId: "org-1",
        handleId: "qh-big",
        mode: "read",
      });
      const [, body] = mockCallWebhook.mock.calls[0] as unknown as [
        unknown,
        any,
      ];
      expect(body.tool).toBe("summarize");
      expect(body.input).toEqual({ factor: 5 });
      expect(body.records).toBeUndefined(); // not records-in-body
      expect(body.source).toMatchObject({
        readUrl: expect.stringContaining("/api/webhook/handle/qh-big"),
        readToken: "tok-abc",
        rowCount: 250_000,
        schema: [{ name: "ts", type: "timestamptz" }],
        pageLimit: 5_000,
      });
      // grant lives only for the call
      expect(mockRevoke).toHaveBeenCalledWith("tok-abc");
    });

    it("refuses a handle the calling org does not own (no token minted)", async () => {
      mockGetMeta.mockResolvedValue({
        rowCount: 10,
        schema: [],
        _organizationId: "org-OTHER",
      });
      const t = buildTool(streaming, "org-1");

      await expect(exec(t, { queryHandle: "qh-foreign" })).rejects.toMatchObject(
        { code: "WEBHOOK_HANDLE_SCOPE_MISMATCH", status: 403 }
      );
      expect(mockMint).not.toHaveBeenCalled();
      expect(mockCallWebhook).not.toHaveBeenCalled();
    });

    it("revokes the token even when the webhook call throws", async () => {
      mockGetMeta.mockResolvedValue({
        rowCount: 200_000,
        schema: [],
        _organizationId: "org-1",
      });
      mockCallWebhook.mockRejectedValue(new Error("runtime 500"));
      const t = buildTool(streaming);

      await expect(exec(t, { queryHandle: "qh-x" })).rejects.toThrow("runtime 500");
      expect(mockRevoke).toHaveBeenCalledWith("tok-abc");
    });

    it("inline rows (ceiling, not mandate): runs records-in-body, no token", async () => {
      mockResolveRecordSource.mockResolvedValue({
        rows: [{ a: 1 }],
        total: 1,
        sampled: false,
      });
      const t = buildTool(streaming);

      await exec(t, { rows: [{ a: 1 }] });

      expect(mockMint).not.toHaveBeenCalled();
      expect(mockGetMeta).not.toHaveBeenCalled();
      expect(mockCallWebhook).toHaveBeenCalledWith(IMPL, {
        tool: "summarize",
        input: {},
        records: [{ a: 1 }],
      });
    });
  });
});
