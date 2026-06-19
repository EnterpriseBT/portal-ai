/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { Consumption } from "@portalai/core/models";

// Capture the body passed to callWebhook; mock the dataset resolver + the
// handle meta + token service the streaming path uses.
const mockCallWebhook = jest.fn<() => Promise<unknown>>();
const mockResolveRecordSource = jest.fn<() => Promise<unknown>>();
const mockGetMeta = jest.fn<() => Promise<unknown>>();
const mockMint = jest.fn<(opts: { mode: string }) => Promise<string>>();
const mockRevoke = jest.fn<() => Promise<void>>();
const mockGetStaged = jest.fn<() => Promise<string | null>>();
const mockClearStaged = jest.fn<() => Promise<void>>();

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
  WebhookReadTokenService: {
    mint: mockMint,
    revoke: mockRevoke,
    getStagedResult: mockGetStaged,
    clearStagedResult: mockClearStaged,
  },
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
    mockMint
      .mockReset()
      .mockImplementation(async (opts) =>
        opts.mode === "write" ? "tok-write" : "tok-read"
      );
    mockRevoke.mockReset().mockResolvedValue(undefined);
    mockGetStaged.mockReset();
    mockClearStaged.mockReset().mockResolvedValue(undefined);
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

    it("queryHandle: POSTs a pull-on-read source grant + an output write grant, revokes both", async () => {
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
      expect(body.input).toEqual({ factor: 5 });
      expect(body.records).toBeUndefined();
      expect(body.source).toMatchObject({
        readUrl: expect.stringContaining("/api/webhook/handle/qh-big"),
        readToken: "tok-read",
        rowCount: 250_000,
        pageLimit: 5_000,
      });
      // output grant for staging a large result
      expect(body.output).toEqual({
        writeUrl: expect.stringMatching(/\/api\/webhook\/handle\/[\w-]+$/),
        writeToken: "tok-write",
      });
      // both grants revoked when the call settles
      expect(mockRevoke).toHaveBeenCalledWith("tok-read");
      expect(mockRevoke).toHaveBeenCalledWith("tok-write");
    });

    it("refuses a handle the calling org does not own (nothing minted)", async () => {
      mockGetMeta.mockResolvedValue({
        rowCount: 10,
        schema: [],
        _organizationId: "org-OTHER",
      });
      const t = buildTool(streaming, "org-1");

      await expect(exec(t, { queryHandle: "qh-foreign" })).rejects.toMatchObject(
        { code: "WEBHOOK_HANDLE_SCOPE_MISMATCH", status: 403 }
      );
      expect(mockMint).not.toHaveBeenCalled(); // org check precedes minting
      expect(mockCallWebhook).not.toHaveBeenCalled();
    });

    it("revokes both grants even when the webhook call throws", async () => {
      mockGetMeta.mockResolvedValue({
        rowCount: 200_000,
        schema: [],
        _organizationId: "org-1",
      });
      mockCallWebhook.mockRejectedValue(new Error("runtime 500"));
      const t = buildTool(streaming);

      await expect(exec(t, { queryHandle: "qh-x" })).rejects.toThrow("runtime 500");
      expect(mockRevoke).toHaveBeenCalledWith("tok-read");
      expect(mockRevoke).toHaveBeenCalledWith("tok-write");
    });

    it("inline rows: records-in-body + an output grant (no read token)", async () => {
      mockResolveRecordSource.mockResolvedValue({
        rows: [{ a: 1 }],
        total: 1,
        sampled: false,
      });
      const t = buildTool(streaming);

      await exec(t, { rows: [{ a: 1 }] });

      expect(mockGetMeta).not.toHaveBeenCalled(); // no input handle
      const [, body] = mockCallWebhook.mock.calls[0] as unknown as [unknown, any];
      expect(body.records).toEqual([{ a: 1 }]);
      expect(body.output.writeToken).toBe("tok-write");
      expect(mockMint).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "write" })
      );
    });

    it("resolves a { resultHandle } response staged this session into a handle envelope", async () => {
      mockResolveRecordSource.mockResolvedValue({ rows: [], total: 0, sampled: false });
      mockCallWebhook.mockResolvedValue({ resultHandle: "qh-result" });
      mockGetStaged.mockResolvedValue("qh-result"); // matches what we staged
      mockGetMeta.mockResolvedValue({
        _organizationId: "org-1",
        rowCount: 5000,
        schema: [{ name: "x", type: "int4" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
      });
      const t = buildTool(streaming);

      const result = (await exec(t, { rows: [{ a: 1 }] })) as any;

      expect(result.queryHandle).toBe("qh-result");
      expect(result.rowCount).toBe(5000);
      expect(result.schema).toEqual([{ name: "x", type: "int4" }]);
    });

    it("rejects a { resultHandle } the call did not stage (WEBHOOK_RESULT_HANDLE_INVALID)", async () => {
      mockResolveRecordSource.mockResolvedValue({ rows: [], total: 0, sampled: false });
      mockCallWebhook.mockResolvedValue({ resultHandle: "qh-someone-elses" });
      mockGetStaged.mockResolvedValue(null); // nothing staged this session
      const t = buildTool(streaming);

      await expect(exec(t, { rows: [{ a: 1 }] })).rejects.toMatchObject({
        code: "WEBHOOK_RESULT_HANDLE_INVALID",
      });
    });
  });
});
