import { describe, it, expect, jest } from "@jest/globals";

// #1022: a colour rejection is logged, so how often the codegen model writes
// its own colours is measurable. Its own file, because the logger is mocked
// before the tool module loads.

const info = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    info,
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const { VisualizeD3Tool } = await import("../../tools/visualize-d3.tool.js");

const PROGRAM = "api.d3.select(api.container).append('svg');";

describe("visualize_d3 colour rejection log (#1022)", () => {
  it("logs the literal and the attempt at info", async () => {
    const generateCode = jest
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(
        `${PROGRAM}\napi.d3.select("svg").attr("fill", "red");`
      )
      .mockResolvedValueOnce(PROGRAM);
    const built = new VisualizeD3Tool().build("station-1", "org-1", "user-1", {
      generateCode: generateCode as never,
      resolveSqlDelivery: (async () => ({
        kind: "inline",
        result: { rows: [{ x: 1 }] },
      })) as never,
    });

    await (
      built as unknown as {
        execute: (a: Record<string, string>) => Promise<unknown>;
      }
    ).execute({ sql: "s", instruction: "i", summary: "One point." });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      { tool: "visualize_d3", attempt: 0, literal: "red" },
      "visualize_d3 colour literal rejected"
    );
  });
});
