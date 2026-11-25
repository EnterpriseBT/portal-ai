import React from "react";

import { jest } from "@jest/globals";

import type { AssignedEntityTag } from "@portalai/core/contracts";
import type { SelectOption } from "@portalai/core/ui";

const { expectNoAxeViolations, render, screen, waitFor } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TagsDialogUI } = await import("../components/TagsDialog.component");
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

const props = (overrides = {}) => ({
  open: true,
  onClose: jest.fn(),
  name: "Sales",
  tags: [tag],
  onAssign: jest.fn(),
  onUnassign: jest.fn(),
  onSearch: jest
    .fn<(q: string) => Promise<SelectOption[]>>()
    .mockResolvedValue([{ value: "tag-2", label: "Ops" }]),
  ...overrides,
});

describe("TagsDialogUI (#1115)", () => {
  it("is titled for its object, with the tags and the picker", () => {
    render(<TagsDialogUI {...props()} />);
    expect(
      screen.getByRole("dialog", { name: "Tags for Sales" })
    ).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByLabelText("Add tag")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<TagsDialogUI {...props({ open: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus to the picker on open", async () => {
    render(<TagsDialogUI {...props()} />);
    await waitFor(() => expect(screen.getByLabelText("Add tag")).toHaveFocus());
  });

  it("assigns a picked tag at once", async () => {
    const p = props();
    render(<TagsDialogUI {...p} />);
    await userEvent.click(screen.getByLabelText("Add tag"));
    await userEvent.click(await screen.findByRole("option", { name: "Ops" }));
    expect(p.onAssign).toHaveBeenCalledWith("tag-2");
  });

  it("unassigns a tag when its chip is removed", async () => {
    const p = props();
    render(<TagsDialogUI {...p} />);
    await userEvent.click(screen.getByTestId("CancelIcon"));
    expect(p.onUnassign).toHaveBeenCalledWith("assignment-1");
  });

  it("returns focus to the row's Edit pencil when it closes", async () => {
    const p = props();
    const Harness = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <TagsMetadataValueUI
            tags={p.tags}
            editGate={{ kind: "allow" }}
            onEdit={() => setOpen(true)}
            name="Sales"
          />
          <TagsDialogUI {...p} open={open} onClose={() => setOpen(false)} />
        </>
      );
    };
    render(<Harness />);
    const edit = screen.getByRole("button", { name: "Edit tags for Sales" });

    await userEvent.click(edit);
    await waitFor(() => expect(screen.getByLabelText("Add tag")).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(edit).toHaveFocus();

    await userEvent.click(edit);
    await waitFor(() => expect(screen.getByLabelText("Add tag")).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(edit).toHaveFocus();
  });

  it("closes on Done", async () => {
    const p = props();
    render(<TagsDialogUI {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const p = props();
    render(<TagsDialogUI {...p} />);
    await waitFor(() => expect(screen.getByLabelText("Add tag")).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(p.onClose).toHaveBeenCalled();
  });

  it("closes from its close button", async () => {
    const p = props();
    render(<TagsDialogUI {...p} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the unauthorized panel without a tag read (#630)", () => {
    render(<TagsDialogUI {...props({ canReadTags: false })} />);
    expect(screen.queryByLabelText("Add tag")).toBeNull();
    expect(
      screen.getByText("You don't have permission to view tags.")
    ).toBeInTheDocument();
  });

  it("has no axe violations when open, with tags and with none", async () => {
    const { unmount } = render(<TagsDialogUI {...props()} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
    unmount();
    render(<TagsDialogUI {...props({ tags: [] })} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });
});
