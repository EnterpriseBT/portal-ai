import type { EntityTag } from "@portalai/core/models";

const { render, screen } = await import("./test-utils");
const { tagSelectOption } = await import("../utils/tag-select-option.util");

const tag = {
  id: "tag-1",
  organizationId: "org-1",
  name: "Finance",
  color: "#2563EB",
  description: null,
} as EntityTag;

describe("tagSelectOption (#1115)", () => {
  it("makes a picker option led by the tag's colour dot", () => {
    const option = tagSelectOption(tag);
    expect(option).toMatchObject({ value: "tag-1", label: "Finance" });
    render(<>{option.icon}</>);
    expect(screen.getByTestId("tag-color-dot")).toHaveStyle({
      backgroundColor: "#2563EB",
    });
  });

  it("leaves out the icon for a tag with no colour", () => {
    expect(tagSelectOption({ ...tag, color: null }).icon).toBeUndefined();
  });
});
