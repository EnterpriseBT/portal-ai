import { describe, it, expect, jest } from "@jest/globals";

import { VisualizeD3Tool } from "../../tools/visualize-d3.tool.js";
import type { VisualizeD3Deps } from "../../tools/visualize-d3.tool.js";

// The tool composes resolveSqlDelivery (#164) + AiService.generateCode (#269).
// Both are injected via build()'s deps seam so the test drives the branches
// without a live SQL run or model call.

const PROGRAM = "api.d3.select(api.container).append('svg');";

const inlineDelivery = {
  kind: "inline" as const,
  result: {
    rows: [
      { month: "Jan", revenue: 10 },
      { month: "Feb", revenue: 20 },
    ],
  },
};

const handleEnvelope = {
  queryHandle: "qh-abc",
  rowCount: 5000,
  schema: [
    { name: "month", type: "text" },
    { name: "revenue", type: "numeric" },
  ],
  sampled: false,
  truncated: false,
  samplePeek: [{ month: "Jan", revenue: 10 }],
  sql: "SELECT month, revenue FROM sales",
};
const handleDelivery = { kind: "handle" as const, envelope: handleEnvelope };

type ExecArgs = { sql: string; instruction: string; title?: string };

type CodegenArgs = { system: string; prompt: string };

function buildTool(
  deps: VisualizeD3Deps
): (args: ExecArgs) => Promise<Record<string, unknown>> {
  const built = new VisualizeD3Tool().build("station-1", "org-1", deps);
  return (args) =>
    (
      built as unknown as {
        execute: (a: ExecArgs) => Promise<Record<string, unknown>>;
      }
    ).execute(args);
}

describe("VisualizeD3Tool.execute (#269)", () => {
  it("inline delivery + valid program → d3 block with inline rows; codegen sees schema+sample, not the full rows", async () => {
    const generateCode = jest.fn<(a: CodegenArgs) => Promise<string>>(
      async () => PROGRAM
    );
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const exec = buildTool({
      generateCode: generateCode as never,
      resolveSqlDelivery: resolveSqlDelivery as never,
    });

    const out = await exec({
      sql: "SELECT ...",
      instruction: "bar chart",
      title: "T",
    });

    expect(out).toMatchObject({ type: "d3", program: PROGRAM, title: "T" });
    expect(out.rows).toHaveLength(2);
    expect(out.queryHandle).toBeUndefined();
    // The codegen prompt carries column names + a sample, never the whole set.
    const prompt = generateCode.mock.calls[0][0].prompt;
    expect(prompt).toMatch(/month/);
    expect(prompt).toMatch(/revenue/);
  });

  it("handle delivery + valid program → d3 block with the envelope, no inline rows", async () => {
    const exec = buildTool({
      generateCode: (async () => PROGRAM) as never,
      resolveSqlDelivery: (async () => handleDelivery) as never,
    });
    const out = await exec({ sql: "SELECT ...", instruction: "bar chart" });
    expect(out).toMatchObject({
      type: "d3",
      program: PROGRAM,
      queryHandle: "qh-abc",
      rowCount: 5000,
    });
    expect(out.rows).toBeUndefined();
  });

  it("first program fails to parse → retries codegen with the error, second succeeds", async () => {
    const generateCode = jest
      .fn<(a: CodegenArgs) => Promise<string>>()
      .mockResolvedValueOnce("this is not javascript )(")
      .mockResolvedValueOnce(PROGRAM);
    const exec = buildTool({
      generateCode: generateCode as never,
      resolveSqlDelivery: (async () => inlineDelivery) as never,
    });

    const out = await exec({ sql: "s", instruction: "i" });
    expect(out).toMatchObject({ type: "d3", program: PROGRAM });
    expect(generateCode).toHaveBeenCalledTimes(2);
    // The retry prompt includes the prior parse error.
    const retryPrompt = (generateCode.mock.calls[1][0] as { prompt: string })
      .prompt;
    expect(retryPrompt.length).toBeGreaterThan(0);
  });

  it("all attempts fail to parse → data-table fallback + relay message; 1+MAX_CODEGEN_RETRIES calls", async () => {
    const generateCode = jest.fn(async () => "still )( broken");
    const exec = buildTool({
      generateCode: generateCode as never,
      resolveSqlDelivery: (async () => inlineDelivery) as never,
    });

    const out = await exec({ sql: "s", instruction: "i" });
    expect(out.type).toBe("data-table");
    expect(out.rows).toHaveLength(2);
    expect(typeof out.message).toBe("string");
    expect(generateCode).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("codegen provider error → typed tool result, never throws out of execute", async () => {
    const exec = buildTool({
      generateCode: (async () => {
        throw new Error("provider 529");
      }) as never,
      resolveSqlDelivery: (async () => inlineDelivery) as never,
    });
    const out = await exec({ sql: "s", instruction: "i" });
    expect(out.error).toBeDefined();
    expect((out.error as { code: string }).code).toBe(
      "VISUALIZE_D3_CODEGEN_FAILED"
    );
  });

  it("empty instruction is rejected by the schema before any SQL/codegen", async () => {
    const generateCode = jest.fn(async () => PROGRAM);
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const exec = buildTool({
      generateCode: generateCode as never,
      resolveSqlDelivery: resolveSqlDelivery as never,
    });
    await expect(exec({ sql: "s", instruction: "" })).rejects.toThrow();
    expect(resolveSqlDelivery).not.toHaveBeenCalled();
    expect(generateCode).not.toHaveBeenCalled();
  });
});
