/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFindById = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ id: "org-1", timezone: "America/Los_Angeles" });

const mockWarn = jest.fn();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { findById: mockFindById },
    },
  },
}));

jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const { CurrentTimeTool } = await import(
  "../../tools/current-time.tool.js"
);

beforeEach(() => {
  jest.clearAllMocks();
  mockFindById.mockResolvedValue({
    id: "org-1",
    timezone: "America/Los_Angeles",
  });
});

type Response = { now: string; timezone: string; localTime: string };

const exec = async (organizationId = "org-1"): Promise<Response> => {
  const result = await new CurrentTimeTool().build(organizationId).execute!(
    {},
    {
      toolCallId: "t",
      messages: [],
      abortSignal: new AbortController().signal,
    }
  );
  return result as Response;
};

describe("CurrentTimeTool", () => {
  it("returns now, timezone, and localTime for a valid org timezone", async () => {
    const r = await exec();
    expect(r.timezone).toBe("America/Los_Angeles");
    expect(r.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(r.localTime).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
    );
  });

  it("now is a valid ISO 8601 UTC instant within 1s of Date.now()", async () => {
    const r = await exec();
    const drift = Math.abs(Date.parse(r.now) - Date.now());
    expect(drift).toBeLessThan(1000);
  });

  it("localTime parses to the same instant as now", async () => {
    const r = await exec();
    // localTime drops sub-second precision; compare at the second
    // granularity so the assertion isn't flaky.
    const nowSec = Math.floor(Date.parse(r.now) / 1000);
    const localSec = Math.floor(Date.parse(r.localTime) / 1000);
    expect(localSec).toBe(nowSec);
  });

  it("falls back to UTC when the org's timezone is not a valid IANA name", async () => {
    mockFindById.mockResolvedValueOnce({ id: "org-1", timezone: "Mars/Olympus" });
    const r = await exec();
    expect(r.timezone).toBe("UTC");
    expect(r.localTime.endsWith("+00:00")).toBe(true);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const [meta, msg] = mockWarn.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(meta).toMatchObject({
      organizationId: "org-1",
      badValue: "Mars/Olympus",
    });
    expect(msg).toMatch(/UTC/i);
  });

  it("falls back to UTC when the org row is missing entirely", async () => {
    mockFindById.mockResolvedValueOnce(undefined);
    const r = await exec();
    expect(r.timezone).toBe("UTC");
    expect(r.localTime.endsWith("+00:00")).toBe(true);
  });
});
