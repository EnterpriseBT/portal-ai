import { withResolvedLabels } from "../use-binding-editor-resolvers.util";
import type { ColumnDefinitionMeta } from "../use-binding-editor-resolvers.util";
import type { RegionDraft } from "../../../../modules/RegionEditor";

const catalog = new Map<string, ColumnDefinitionMeta>([
  ["cd_email", { label: "Email", type: "string", description: null }],
  ["cd_phone", { label: "Phone", type: "string", description: null }],
]);

const region = (binding: RegionDraft["columnBindings"]): RegionDraft => ({
  id: "r1",
  sheetId: "s1",
  bounds: { startRow: 0, endRow: 1, startCol: 0, endCol: 0 },
  targetEntityDefinitionId: "ent",
  columnBindings: binding,
});

describe("withResolvedLabels (#795)", () => {
  test("a binding with no label gets the catalog's", () => {
    const [r] = withResolvedLabels(
      [
        region([
          {
            sourceLocator: "header:a",
            columnDefinitionId: "cd_email",
            confidence: 1,
          },
        ]),
      ],
      catalog
    );
    expect(r.columnBindings![0].columnDefinitionLabel).toBe("Email");
  });

  test("after a rebind, the label follows the new id, not the cached one", () => {
    const [r] = withResolvedLabels(
      [
        region([
          {
            sourceLocator: "header:a",
            columnDefinitionId: "cd_phone",
            columnDefinitionLabel: "Email",
            confidence: 1,
          },
        ]),
      ],
      catalog
    );
    expect(r.columnBindings![0].columnDefinitionLabel).toBe("Phone");
  });

  test("an id the catalog doesn't know keeps its own label", () => {
    const [r] = withResolvedLabels(
      [
        region([
          {
            sourceLocator: "header:a",
            columnDefinitionId: "cd_gone",
            columnDefinitionLabel: "Old",
            confidence: 1,
          },
        ]),
      ],
      catalog
    );
    expect(r.columnBindings![0].columnDefinitionLabel).toBe("Old");
  });
});
