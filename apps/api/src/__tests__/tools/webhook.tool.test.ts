/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { Consumption } from "@portalai/core/models";

// Capture the body passed to callWebhook; mock the dataset resolver.
const mockCallWebhook = jest.fn<() => Promise<unknown>>();
const mockResolveRecordSource = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/tools.service.js", () => ({
  ToolService: { callWebhook: mockCallWebhook },
}));
jest.unstable_mockModule("../../tools/record-source.js", () => ({
  resolveRecordSource: mockResolveRecordSource,
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

function buildTool(consumption?: Consumption) {
  return new WebhookTool(
    "summarize",
    "Summarize the records.",
    PARAM_SCHEMA,
    IMPL,
    "station-1",
    consumption
  ).build();
}

describe("WebhookTool — consumption-tiered body (#124)", () => {
  beforeEach(() => {
    mockCallWebhook.mockReset().mockResolvedValue({ ok: true });
    mockResolveRecordSource.mockReset();
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
});
