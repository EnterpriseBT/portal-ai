import { jest } from "@jest/globals";

import type { AssignedEntityTag } from "@portalai/core/contracts";

const { render, screen } = await import("./test-utils");
const { tagsMetadataItem } = await import("../utils/tags-metadata.util");

const tag = {
  id: "tag-1",
  assignmentId: "assignment-1",
  name: "Finance",
  color: null,
} as AssignedEntityTag;

const input = (overrides = {}) => ({
  tags: [tag],
  canWrite: true,
  canReadTags: true,
  name: "Sales",
  onEdit: jest.fn(),
  ...overrides,
});

describe("tagsMetadataItem (#1115)", () => {
  it("is a Tags chip row", () => {
    const item = tagsMetadataItem(input());
    expect(item).toMatchObject({
      label: "Tags",
      variant: "chip",
      hidden: false,
    });
  });

  it("is hidden while the tags load", () => {
    expect(tagsMetadataItem(input({ tags: undefined })).hidden).toBe(true);
  });

  it("is hidden without a tag read, even for a writer (#630)", () => {
    expect(tagsMetadataItem(input({ canReadTags: false })).hidden).toBe(true);
  });

  it("is hidden for a reader of an object with no tags", () => {
    expect(tagsMetadataItem(input({ canWrite: false, tags: [] })).hidden).toBe(
      true
    );
  });

  it("shows a writer the row with no tags, so Edit stays reachable", () => {
    const item = tagsMetadataItem(input({ tags: [] }));
    expect(item.hidden).toBe(false);
    render(<>{item.value}</>);
    expect(screen.getByText("No tags")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit tags for Sales" })
    ).toBeInTheDocument();
  });

  it("shows a reader the chips without Edit", () => {
    const item = tagsMetadataItem(input({ canWrite: false }));
    expect(item.hidden).toBe(false);
    render(<>{item.value}</>);
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit tags/ })).toBeNull();
  });
});
