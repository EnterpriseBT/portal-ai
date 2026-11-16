import React from "react";
import { describe, it, expect } from "@jest/globals";

import { DataTable } from "../../ui/DataTable";

// #794: a table must be named, by exactly one of `label` or
// `aria-labelledby`. These assertions are checked by `npm run type-check`;
// the runtime test only keeps the file in the suite.
describe("DataTable props (type-level)", () => {
  it("compiles a named table and rejects an unnamed or doubly named one", () => {
    const valid = [
      <DataTable key="label" label="People" columns={[]} rows={[]} />,
      <DataTable key="by" aria-labelledby="h" columns={[]} rows={[]} />,
    ];

    const invalid = [
      // @ts-expect-error a table needs a name
      <DataTable key="none" columns={[]} rows={[]} />,
      // @ts-expect-error label and aria-labelledby are exclusive
      <DataTable
        key="both"
        label="P"
        aria-labelledby="h"
        columns={[]}
        rows={[]}
      />,
    ];

    expect(valid).toHaveLength(2);
    expect(invalid).toHaveLength(2);
  });
});
