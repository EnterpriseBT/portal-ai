import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { LlmBridge } from "@portalai/core/contracts";

import { createAnthropicStub } from "../stubs/anthropic-stub.js";

// Real request bodies captured from `ai` + `@ai-sdk/anthropic` (the API's
// versions) calling generateObject with interpret's two schemas. The SDK uses
// native structured output (`output_config.format`), not a tool call.
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/anthropic-${name}.request.json`, import.meta.url),
      "utf8"
    )
  );

let server: Server;
let base: string;
beforeAll(async () => {
  server = createAnthropicStub();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = (body: unknown) =>
  fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const textJson = async (res: Response): Promise<unknown> => {
  const msg = (await res.json()) as {
    content: { type: string; text: string }[];
    stop_reason: string;
  };
  expect(msg.content[0].type).toBe("text");
  expect(msg.stop_reason).toBe("end_turn");
  return JSON.parse(msg.content[0].text);
};

describe("anthropic stub", () => {
  it("answers the classifier with no confident match", async () => {
    const res = await post(fixture("classifier"));
    expect(res.status).toBe(200);
    const out = await textJson(res);
    expect(LlmBridge.ClassifierResponseSchema.parse(out)).toEqual({
      classifications: [],
    });
  });

  it("answers the axis-name recommender with a zero-confidence name", async () => {
    const out = await textJson(await post(fixture("axis-name")));
    expect(LlmBridge.AxisNameRecommenderResponseSchema.parse(out)).toEqual({
      name: "value",
      confidence: 0,
    });
  });

  it("answers a tool-mode request with a tool_use block", async () => {
    const res = await post({
      model: "m",
      messages: [],
      tools: [
        {
          name: "json",
          input_schema: { properties: { classifications: {} } },
        },
      ],
    });
    const msg = (await res.json()) as {
      content: { type: string; name: string; input: unknown }[];
      stop_reason: string;
    };
    expect(msg.content[0]).toMatchObject({
      type: "tool_use",
      name: "json",
      input: { classifications: [] },
    });
    expect(msg.stop_reason).toBe("tool_use");
  });

  // A new LLM call site must fail the walk loudly, not pass on a guess.
  it("refuses a schema it doesn't recognise", async () => {
    const res = await post({
      model: "m",
      messages: [],
      output_config: {
        format: { type: "json_schema", schema: { properties: { x: {} } } },
      },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/unrecognized schema/);
  });

  it("serves a health check", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});
