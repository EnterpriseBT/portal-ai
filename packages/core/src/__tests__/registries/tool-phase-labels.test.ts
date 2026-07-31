import {
  TOOL_PHASE_LABELS,
  MAX_DERIVED_LABEL_LEN,
  deriveToolPhaseLabel,
  toolPhaseLabel,
} from "../../registries/tool-phase-labels.js";
import { ALL_TOOL_CAPABILITIES } from "../../registries/tool-capabilities.js";

// #279 — the phase label is what the user reads while a tool runs. Every
// built-in tool needs curated copy: the derived fallback exists for custom
// webhook tools (which have no capability row), and letting a built-in fall
// through to it produces the "Running var cvar" copy this registry exists to
// avoid. The key-set assertion forces a label when a tool is added.
describe("TOOL_PHASE_LABELS", () => {
  it("pin key-set == registry key-set (adding/removing a tool forces a label)", () => {
    expect(Object.keys(TOOL_PHASE_LABELS).sort()).toEqual(
      Object.keys(ALL_TOOL_CAPABILITIES).sort()
    );
  });

  it("every label is non-empty and trimmed", () => {
    for (const [name, label] of Object.entries(TOOL_PHASE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).toBe(label.trim());
      expect(name).toBeTruthy();
    }
  });

  it("every label starts with an uppercase letter (sentence case)", () => {
    for (const label of Object.values(TOOL_PHASE_LABELS)) {
      expect(label[0]).toBe(label[0]?.toUpperCase());
    }
  });

  it("no label exceeds the derived-label ceiling", () => {
    for (const label of Object.values(TOOL_PHASE_LABELS)) {
      expect(label.length).toBeLessThanOrEqual(MAX_DERIVED_LABEL_LEN);
    }
  });
});

describe("toolPhaseLabel", () => {
  it("returns the curated label for a built-in tool", () => {
    expect(toolPhaseLabel("sql_query")).toBe("Querying your data");
    expect(toolPhaseLabel("visualize_d3")).toBe("Building the chart");
  });

  it("derives a label for an unknown (custom webhook) tool", () => {
    expect(toolPhaseLabel("refresh_crm")).toBe("Running refresh crm");
  });

  it("never returns an empty string for any input", () => {
    for (const name of ["", "   ", "x", "a_b_c", "sql_query"]) {
      expect(toolPhaseLabel(name).length).toBeGreaterThan(0);
    }
  });
});

describe("deriveToolPhaseLabel", () => {
  it("converts snake_case to spaced words", () => {
    expect(deriveToolPhaseLabel("refresh_crm")).toBe("Running refresh crm");
  });

  it("collapses hyphens and repeated separators", () => {
    expect(deriveToolPhaseLabel("sync__all-records")).toBe(
      "Running sync all records"
    );
  });

  it("lowercases the derived words and trims stray separators", () => {
    expect(deriveToolPhaseLabel("_Fetch_INVOICES_")).toBe(
      "Running fetch invoices"
    );
  });

  it("falls back to a generic label for empty or separator-only input", () => {
    expect(deriveToolPhaseLabel("")).toBe("Running a tool");
    expect(deriveToolPhaseLabel("   ")).toBe("Running a tool");
    expect(deriveToolPhaseLabel("___")).toBe("Running a tool");
  });

  it("truncates an over-long name to the ceiling", () => {
    const label = deriveToolPhaseLabel("a_very".repeat(40));
    expect(label.length).toBeLessThanOrEqual(MAX_DERIVED_LABEL_LEN);
    expect(label.endsWith("…")).toBe(true);
  });
});
