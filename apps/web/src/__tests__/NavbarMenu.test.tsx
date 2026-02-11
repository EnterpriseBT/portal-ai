import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavbarMenuUI } from "../components/NavbarMenu.component";
import { MenuItem, ListItemText } from "@mcp-ui/core";

describe("NavbarMenuUI Component", () => {
  it("should render image", () => {
    render(
      <NavbarMenuUI
        image="https://example.com/user.jpg"
        label="John Doe"
      />
    );
    const avatar = screen.getByAltText("John Doe");
    expect(avatar).toHaveAttribute("src", "https://example.com/user.jpg");
  });

  it("should render label", () => {
    render(<NavbarMenuUI label="John Doe" />);
    expect(screen.getByText("John Doe")).toBeInTheDocument();
  });

  it("should render children", async () => {
    const user = userEvent.setup();
    render(
      <NavbarMenuUI>
        <MenuItem>
          <ListItemText>Custom Item</ListItemText>
        </MenuItem>
      </NavbarMenuUI>
    );

    const avatarButton = screen.getByRole("button", { name: /account menu/i });
    await user.click(avatarButton);

    expect(screen.getByText("Custom Item")).toBeInTheDocument();
  });
});
