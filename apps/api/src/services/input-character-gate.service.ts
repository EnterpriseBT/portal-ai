import { ApiCode } from "../constants/api-codes.constants.js";
import { findNul } from "../utils/nul-character.util.js";
import type { GateableTool } from "./cost-gate.service.js";

/** The typed result a call refused for a NUL in its input returns. */
export function inputCharacterRefusal(path: string): {
  error: { code: ApiCode; message: string; path: string };
} {
  return {
    error: {
      code: ApiCode.TOOL_INPUT_INVALID_CHARACTERS,
      message: `Tool input${
        path ? ` at \`${path}\`` : ""
      } contains a NUL character (U+0000), which can't be stored. Retry without it.`,
      path,
    },
  };
}

/**
 * Refuse a built-in tool call whose input carries U+0000 (#805), **in place**.
 *
 * The model's tool-call JSON can hold `\u0000` like any client, and no
 * Postgres text or jsonb value can store (or a search bind) one, so the call
 * would fail mid-tool. The refusal is a typed result the agent can relay or
 * retry clean, and the tool never runs.
 *
 * Applied **outside** the cost gate: `wrapWithCostGate` charges any result
 * that resolves, so a refusal returned from inside it would be charged.
 * Custom (webhook) tools are exempt: their input goes to the org's endpoint
 * as JSON, where a NUL is legal, and never to our database.
 */
export function wrapWithInputCharacterGate(
  tools: Record<string, GateableTool>,
  isCustom: (toolName: string) => boolean
): void {
  for (const [name, tool] of Object.entries(tools)) {
    const original = tool.execute;
    if (!original || isCustom(name)) continue;

    tool.execute = async (input: unknown, options: unknown) => {
      const hit = findNul(input);
      if (hit) return inputCharacterRefusal(hit.path);
      return original(input, options);
    };
  }
}
