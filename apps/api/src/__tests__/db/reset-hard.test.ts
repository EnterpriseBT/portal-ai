import { describe, it, expect } from "@jest/globals";

import { partitionTables } from "../../db/reset-hard.js";

describe("reset-hard / partitionTables", () => {
  it("separates `er__*` wide tables from the static schema", () => {
    const result = partitionTables([
      "users",
      "er__abc-123",
      "connector_entities",
      "er__def-456",
      "jobs",
    ]);
    expect(result.toDrop.sort()).toEqual(["er__abc-123", "er__def-456"]);
    expect(result.toTruncate.sort()).toEqual([
      "connector_entities",
      "jobs",
      "users",
    ]);
  });

  it("matches the prefix as a starts-with, not anywhere in the name", () => {
    // A table named `something_er__x` is not a wide table — wide
    // tables are exclusively named `er__<connector_entity_id>`.
    const result = partitionTables(["table_er__not_wide", "er__yes_wide"]);
    expect(result.toDrop).toEqual(["er__yes_wide"]);
    expect(result.toTruncate).toEqual(["table_er__not_wide"]);
  });

  it("handles an empty input cleanly", () => {
    expect(partitionTables([])).toEqual({ toDrop: [], toTruncate: [] });
  });
});
