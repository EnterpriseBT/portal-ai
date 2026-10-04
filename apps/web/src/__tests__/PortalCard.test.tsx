import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { PortalCardUI } = await import("../components/PortalCard.component");

const props = {
  id: "portal-1",
  name: "Sales Analysis",
  created: Date.now() - 3600000,
  lastOpened: null,
  canDelete: true,
  onClick: jest.fn(),
  onDelete: jest.fn(),
};

describe("PortalCardUI", () => {
  it("renders the name and opens on click", () => {
    render(<PortalCardUI {...props} />);
    fireEvent.click(screen.getByText("Sales Analysis"));
    expect(props.onClick).toHaveBeenCalledWith("portal-1");
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
