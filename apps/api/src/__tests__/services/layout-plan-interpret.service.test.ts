import { jest, describe, it, expect } from "@jest/globals";

import type { PermissionSet } from "../../services/permission-set.js";

const findByOrganizationId = jest.fn(async () => [
  {
    id: "cd-sys",
    key: "email",
    label: "Email",
    description: null,
    type: "string",
    createdBy: "SYS",
  },
  {
    id: "cd-own",
    key: "secret",
    label: "Secret",
    description: "Owner's",
    type: "string",
    createdBy: "OWNER",
  },
]);

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { columnDefinitions: { findByOrganizationId } },
  },
}));

const { LayoutPlanInterpretService } =
  await import("../../services/layout-plan-interpret.service.js");

describe("LayoutPlanInterpretService.loadCatalog (#834)", () => {
  it("offers the classifier only the column definitions the caller can read", async () => {
    const can = jest.fn(
      (_action: string, object?: { createdBy?: string }) =>
        object?.createdBy === "SYS"
    );
    const catalog = await LayoutPlanInterpretService.loadCatalog("org-1", {
      can,
    } as unknown as PermissionSet);

    expect(findByOrganizationId).toHaveBeenCalledWith("org-1");
    expect(catalog).toEqual([
      {
        id: "cd-sys",
        label: "Email",
        normalizedKey: "email",
        description: undefined,
        type: "string",
      },
    ]);
    expect(can).toHaveBeenCalledWith("resource.read", {
      type: "column_definition",
      id: "cd-own",
      createdBy: "OWNER",
    });
  });
});
