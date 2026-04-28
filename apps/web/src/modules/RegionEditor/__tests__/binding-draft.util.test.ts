import { describe, it, expect } from "@jest/globals";

import { applyBindingDraftPatch } from "../utils/binding-draft.util";
import type { ColumnBindingDraft } from "../utils/region-editor.types";

function refBinding(): ColumnBindingDraft {
  return {
    sourceLocator: "header:CustomerId",
    columnDefinitionId: "coldef_ref",
    columnDefinitionLabel: "Customer",
    columnDefinitionType: "reference",
    confidence: 0.9,
    refEntityKey: "customers",
    refNormalizedKey: "id",
  };
}

describe("applyBindingDraftPatch", () => {
  it("merges non-definition patches without disturbing other fields", () => {
    const draft = refBinding();
    const next = applyBindingDraftPatch(draft, { normalizedKey: "customer_id" });
    expect(next.normalizedKey).toBe("customer_id");
    expect(next.refEntityKey).toBe("customers");
    expect(next.refNormalizedKey).toBe("id");
    expect(next.columnDefinitionType).toBe("reference");
    expect(next.columnDefinitionLabel).toBe("Customer");
  });

  it("clears cached display fields and type-dependent overrides when columnDefinitionId changes", () => {
    const draft = refBinding();
    const next = applyBindingDraftPatch(draft, {
      columnDefinitionId: "coldef_plain_text",
    });
    expect(next.columnDefinitionId).toBe("coldef_plain_text");
    // Cached display — must not carry "reference" into the new definition.
    expect(next.columnDefinitionType).toBeUndefined();
    expect(next.columnDefinitionLabel).toBeUndefined();
    // Type-dependent overrides from the prior reference binding — stale.
    expect(next.refEntityKey).toBeNull();
    expect(next.refNormalizedKey).toBeNull();
    expect(next.enumValues).toBeNull();
    // Unrelated fields remain.
    expect(next.sourceLocator).toBe(draft.sourceLocator);
    expect(next.confidence).toBe(draft.confidence);
  });

  it("clears stale enum values when switching away from an enum binding", () => {
    const draft: ColumnBindingDraft = {
      sourceLocator: "header:Status",
      columnDefinitionId: "coldef_enum",
      columnDefinitionLabel: "Status",
      columnDefinitionType: "enum",
      enumValues: ["open", "closed"],
      confidence: 0.9,
    };
    const next = applyBindingDraftPatch(draft, {
      columnDefinitionId: "coldef_number",
    });
    expect(next.enumValues).toBeNull();
    expect(next.columnDefinitionType).toBeUndefined();
  });

  it("does not clear when columnDefinitionId is patched but the value is the same", () => {
    const draft = refBinding();
    const next = applyBindingDraftPatch(draft, {
      columnDefinitionId: draft.columnDefinitionId,
    });
    expect(next.refEntityKey).toBe("customers");
    expect(next.refNormalizedKey).toBe("id");
    expect(next.columnDefinitionType).toBe("reference");
  });

  it("lets the patch override the cleared defaults when it supplies new values", () => {
    const draft = refBinding();
    // User switches to a new reference definition; the parent prefilled the
    // picker's option with label + type so those should pass through as-is.
    const next = applyBindingDraftPatch(draft, {
      columnDefinitionId: "coldef_other_ref",
      columnDefinitionType: "reference",
      columnDefinitionLabel: "Vendor",
    });
    expect(next.columnDefinitionType).toBe("reference");
    expect(next.columnDefinitionLabel).toBe("Vendor");
    // Ref fields still clear — user needs to re-pick target for the new def.
    expect(next.refEntityKey).toBeNull();
    expect(next.refNormalizedKey).toBeNull();
  });
});
