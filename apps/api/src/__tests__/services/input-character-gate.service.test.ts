import { describe, it, expect, jest } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";

const { wrapWithInputCharacterGate } =
  await import("../../services/input-character-gate.service.js");

/**
 * #805: a tool's input can carry U+0000 like any client, and Postgres can't
 * store or bind one. The gate refuses such a call with a typed result the
 * agent can act on, before the tool (or the cost gate) runs.
 */
function makeTools() {
  const builtin = jest.fn(async (input: unknown) => ({ echoed: input }));
  const custom = jest.fn(async (input: unknown) => ({ echoed: input }));
  const tools: Record<
    string,
    { execute?: (input: unknown, options: unknown) => unknown }
  > = {
    entity_record_create: { execute: builtin },
    org_webhook: { execute: custom },
    no_execute: {},
  };
  return { tools, builtin, custom };
}

describe("wrapWithInputCharacterGate", () => {
  it("refuses a built-in tool's NUL input without running it, naming the path", async () => {
    const { tools, builtin } = makeTools();
    wrapWithInputCharacterGate(tools, (name) => name === "org_webhook");

    const out = await tools.entity_record_create!.execute!(
      { items: [{ data: { name: "Al\u0000ice" } }] },
      {}
    );

    expect(builtin).not.toHaveBeenCalled();
    expect(out).toEqual({
      error: {
        code: ApiCode.TOOL_INPUT_INVALID_CHARACTERS,
        message:
          "Tool input at `items.0.data.name` contains a NUL character (U+0000), which can't be stored. Retry without it.",
        path: "items.0.data.name",
      },
    });
  });

  it("names no path when the input itself is the string", async () => {
    const { tools } = makeTools();
    wrapWithInputCharacterGate(tools, () => false);

    const out = await tools.entity_record_create!.execute!("x\u0000", {});

    expect(out).toEqual({
      error: {
        code: ApiCode.TOOL_INPUT_INVALID_CHARACTERS,
        message:
          "Tool input contains a NUL character (U+0000), which can't be stored. Retry without it.",
        path: "",
      },
    });
  });

  it("delegates clean input unchanged", async () => {
    const { tools, builtin } = makeTools();
    wrapWithInputCharacterGate(tools, () => false);

    const input = { search: "tab\there" };
    const out = await tools.entity_record_create!.execute!(input, { o: 1 });

    expect(builtin).toHaveBeenCalledWith(input, { o: 1 });
    expect(out).toEqual({ echoed: input });
  });

  it("lets a custom tool's NUL input through: it goes to the org's webhook, not our database", async () => {
    const { tools, custom } = makeTools();
    wrapWithInputCharacterGate(tools, (name) => name === "org_webhook");

    await tools.org_webhook!.execute!({ q: "a\u0000" }, {});

    expect(custom).toHaveBeenCalledTimes(1);
  });

  it("skips a tool with no execute", () => {
    const { tools } = makeTools();
    wrapWithInputCharacterGate(tools, () => false);
    expect(tools.no_execute!.execute).toBeUndefined();
  });
});
