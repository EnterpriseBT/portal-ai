import { trimViolations } from "../lib/a11y-record.js";

describe("trimViolations", () => {
  it("keeps id, impact, tags and targets, and drops each node's html", () => {
    const out = trimViolations([
      {
        id: "image-alt",
        impact: "critical",
        tags: ["wcag2a", "wcag111"],
        description: "Images must have alternate text",
        nodes: [
          {
            target: ["img.logo"],
            html: '<img src="a.png" class="logo">',
            failureSummary: "x",
          },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        id: "image-alt",
        impact: "critical",
        tags: ["wcag2a", "wcag111"],
        nodes: [{ target: ["img.logo"] }],
      },
    ]);
    expect(JSON.stringify(out)).not.toContain("<img");
  });

  it("flattens a frame or shadow-DOM target path into one selector string", () => {
    const out = trimViolations([
      {
        id: "x",
        impact: null,
        tags: [],
        nodes: [{ target: [["iframe", "#chart svg"]] }],
      },
    ]);
    expect(out[0].nodes[0].target).toEqual(["iframe >>> #chart svg"]);
  });
});
