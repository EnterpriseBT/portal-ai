import { jest } from "@jest/globals";

import type { AssignedEntityTag } from "@portalai/core/contracts";
import type { SelectOption } from "@portalai/core/ui";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TagsSectionUI } = await import("../components/TagsSection.component");

const tag: AssignedEntityTag = {
  id: "tag-1",
  assignmentId: "assignment-1",
  organizationId: "org-1",
  name: "Finance",
  color: "#2563EB",
  description: null,
  sourcePortalId: null,
  created: 1,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const allow = { kind: "allow" } as const;
const hide = { kind: "hide" } as const;

const props = (overrides = {}) => ({
  tags: [tag],
  gate: allow,
  onAssign: jest.fn(),
  onUnassign: jest.fn(),
  onSearch: jest
    .fn<(q: string) => Promise<SelectOption[]>>()
    .mockResolvedValue([]),
  ...overrides,
});

describe("TagsSectionUI (#1070)", () => {
  it("lets a writer add and remove tags", async () => {
    const p = props();
    const { container } = render(<TagsSectionUI {...p} />);
    expect(screen.getByRole("heading", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByLabelText("Add tag")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await userEvent.click(screen.getByTestId("CancelIcon"));
    expect(p.onUnassign).toHaveBeenCalledWith("assignment-1");
  });

  it("shows a writer the picker with no tags yet", () => {
    render(<TagsSectionUI {...props({ tags: [] })} />);
    expect(screen.getByLabelText("Add tag")).toBeInTheDocument();
  });

  it("shows a read-only caller the chips, without editing", () => {
    render(<TagsSectionUI {...props({ gate: hide })} />);
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add tag")).toBeNull();
    expect(screen.queryByTestId("CancelIcon")).toBeNull();
  });

  it("renders nothing for a read-only caller when there are no tags", () => {
    const { container } = render(
      <TagsSectionUI {...props({ gate: hide, tags: [] })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the tags load", () => {
    const { container } = render(
      <TagsSectionUI {...props({ tags: undefined })} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
