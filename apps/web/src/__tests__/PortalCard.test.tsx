import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { PortalCardUI } = await import("../components/PortalCard.component");

const props = {
  id: "portal-1",
  name: "Sales Analysis",
  created: Date.now() - 3600000,
  lastOpened: null,
  canDelete: true,
  onDelete: jest.fn(),
};

describe("PortalCardUI", () => {
  // #794: the card opens its portal through its title's link.
  it("links its name to the portal", () => {
    render(<PortalCardUI {...props} />);
    expect(
      screen.getByRole("link", { name: "Sales Analysis" })
    ).toHaveAttribute("href", "/portals/portal-1");
  });

  it("#690: shows Delete when the caller may delete the portal", () => {
    render(<PortalCardUI {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("portal-1");
  });

  it("#690: hides Delete when the caller may not", () => {
    render(<PortalCardUI {...props} canDelete={false} />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
