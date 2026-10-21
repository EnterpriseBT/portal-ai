import { describe, it, expect } from "@jest/globals";

import { curatedViewUpdateBody } from "../utils/curated-view-update-body.util";

// #801 adversarial §6.1: an edit sends only the label and description the user
// changed, so a view saved before the length limits stays editable.
describe("curatedViewUpdateBody", () => {
  const view = {
    label: "V".repeat(500),
    description: "Northeast accounts",
  };
  const form = {
    label: "V".repeat(500),
    description: "Northeast accounts",
    filter: null,
    filterSql: null,
    fieldMappingIds: ["fm-1"],
  };

  it("leaves out an unchanged label and description", () => {
    expect(curatedViewUpdateBody(view, form)).toEqual({
      filter: null,
      filterSql: null,
      fieldMappingIds: ["fm-1"],
    });
  });

  it("sends a changed label, trimmed", () => {
    expect(
      curatedViewUpdateBody(view, { ...form, label: "  NE accounts " })
    ).toMatchObject({ label: "NE accounts" });
  });

  it("sends a cleared description as null", () => {
    expect(
      curatedViewUpdateBody(view, { ...form, description: "  " })
    ).toMatchObject({ description: null });
  });

  it("treats a view with no description as unchanged when the form is empty", () => {
    expect(
      curatedViewUpdateBody(
        { ...view, description: null },
        { ...form, description: "" }
      )
    ).not.toHaveProperty("description");
  });

  it("always sends the SQL filter (#644)", () => {
    expect(
      curatedViewUpdateBody(view, { ...form, filterSql: "amount > cost" })
    ).toMatchObject({ filter: null, filterSql: "amount > cost" });
  });
});
