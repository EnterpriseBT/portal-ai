/**
 * The one sentence a subprocessor renders as (#613), shared by the privacy
 * policy and /security/ so the two pages can't word the same entry apart.
 */
import { describe, it, expect } from "@jest/globals";

import { SUBPROCESSORS } from "@portalai/core/content";

import { subprocessorLine } from "../subprocessor-line.js";

describe("subprocessorLine", () => {
  it("joins name and purpose", () => {
    expect(
      subprocessorLine({
        id: "aws",
        name: "AWS",
        purpose: "Hosting.",
        usedWhen: null,
        reachedBy: ["server"],
      })
    ).toBe("AWS: Hosting.");
  });

  it("appends the condition as its own sentence", () => {
    expect(
      subprocessorLine({
        id: "tavily",
        name: "Tavily",
        purpose: "Web search.",
        usedWhen: "when a portal question uses the web-search tool",
        reachedBy: ["server"],
      })
    ).toBe(
      "Tavily: Web search. Used when a portal question uses the web-search tool."
    );
  });

  it("renders every published entry as clean prose", () => {
    for (const s of SUBPROCESSORS) {
      const line = subprocessorLine(s);
      expect(line).not.toMatch(/\.\./);
      expect(line).toMatch(/[.!?]$/);
    }
  });
});
