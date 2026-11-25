import { jest } from "@jest/globals";

import type { AssignedEntityTag } from "@portalai/core/contracts";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TagsMetadataValueUI } =
  await import("../components/TagsMetadataValue.component");

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

describe("TagsMetadataValueUI (#1115)", () => {
  it("shows the tags read-only, with an Edit button naming the object", async () => {
    const onEdit = jest.fn();
    const { container } = render(
      <TagsMetadataValueUI
        tags={[tag]}
        editGate={allow}
        onEdit={onEdit}
        name="Sales"
      />
    );
    expect(screen.getByText("Finance")).toBeInTheDocument();
    // Removal happens in the dialog, never from the row.
    expect(screen.queryByTestId("CancelIcon")).toBeNull();
    await expectNoAxeViolations(container);

    await userEvent.click(
      screen.getByRole("button", { name: "Edit tags for Sales" })
    );
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("shows only the Edit button for a writer when there are none", async () => {
    const { container } = render(
      <TagsMetadataValueUI
        tags={[]}
        editGate={allow}
        onEdit={jest.fn()}
        name="Sales"
      />
    );
    expect(screen.queryByText("No tags")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit tags for Sales" })
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("renders no Edit button when its gate hides it", async () => {
    const { container } = render(
      <TagsMetadataValueUI
        tags={[tag]}
        editGate={hide}
        onEdit={jest.fn()}
        name="Sales"
      />
    );
    expect(screen.queryByRole("button", { name: /Edit tags/ })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("renders a disabled gate focusable, with its reason", async () => {
    const onEdit = jest.fn();
    render(
      <TagsMetadataValueUI
        tags={[tag]}
        editGate={{ kind: "disable", reason: "Not now" }}
        onEdit={onEdit}
        name="Sales"
      />
    );
    const edit = screen.getByRole("button", { name: "Edit tags for Sales" });
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(edit).toHaveAccessibleDescription("Not now");
    await userEvent.click(edit);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
