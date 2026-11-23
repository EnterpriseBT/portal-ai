import { jest } from "@jest/globals";

import type { SelectOption } from "@portalai/core/ui";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TagAssignSelectUI } =
  await import("../components/TagAssignSelect.component");

const onSearch = () =>
  jest
    .fn<(q: string) => Promise<SelectOption[]>>()
    .mockResolvedValue([{ value: "tag-1", label: "Finance" }]);

describe("TagAssignSelectUI (#1070)", () => {
  it("assigns the picked tag", async () => {
    const onAssign = jest.fn();
    const { container } = render(
      <TagAssignSelectUI onSearch={onSearch()} onAssign={onAssign} />
    );
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByLabelText("Add tag"));
    await userEvent.click(
      await screen.findByRole("option", { name: "Finance" })
    );
    expect(onAssign).toHaveBeenCalledWith("tag-1");
  });

  it("shows an unauthorized panel to a caller who can't read tags", () => {
    render(
      <TagAssignSelectUI
        onSearch={onSearch()}
        onAssign={jest.fn()}
        canRead={false}
      />
    );
    expect(
      screen.getByText("You don't have permission to view tags.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Add tag")).toBeNull();
  });
});
