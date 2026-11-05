import { jest } from "@jest/globals";
import { render, screen, expectNoAxeViolations } from "./test-utils";
import userEvent from "@testing-library/user-event";
import { MenuItem, ListItemText } from "@portalai/core/ui";

// Mock sdk to avoid import.meta.env in api.util.ts
jest.mock("../api/sdk", () => ({
  sdk: {
    auth: {
      session: () => ({
        user: undefined,
        isAuthenticated: false,
        isLoading: false,
        error: undefined,
      }),
      logout: () => ({ logout: jest.fn() }),
    },
    organizations: {
      current: () => ({ data: undefined }),
    },
  },
  queryKeys: {},
}));

import { HeaderMenuUI } from "../components/HeaderMenu.component";

describe("HeaderMenuUI Component", () => {
  it("should render image", () => {
    render(
      <HeaderMenuUI image="https://example.com/user.jpg" label="John Doe" />
    );
    // Decorative: the button is already named by the user's name (#797).
    const avatar = screen.getByRole("presentation", { hidden: true });
    expect(avatar).toHaveAttribute("src", "https://example.com/user.jpg");
    expect(avatar).toHaveAttribute("alt", "");
  });

  it("should render label", () => {
    render(<HeaderMenuUI label="John Doe" />);
    expect(screen.getByText("John Doe")).toBeInTheDocument();
  });

  it("should render children", async () => {
    const user = userEvent.setup();
    render(
      <HeaderMenuUI>
        <MenuItem>
          <ListItemText>Custom Item</ListItemText>
        </MenuItem>
      </HeaderMenuUI>
    );

    const avatarButton = screen.getByRole("button", { name: "Account" });
    await user.click(avatarButton);

    expect(screen.getByText("Custom Item")).toBeInTheDocument();
  });

  it("should render a Settings menu item that links to /settings", async () => {
    const user = userEvent.setup();
    render(
      <HeaderMenuUI>
        <MenuItem component="a" href="/settings">
          <ListItemText>Settings</ListItemText>
        </MenuItem>
      </HeaderMenuUI>
    );

    const avatarButton = screen.getByRole("button", { name: "Account" });
    await user.click(avatarButton);

    const settingsItem = screen.getByText("Settings");
    expect(settingsItem).toBeInTheDocument();
    expect(settingsItem.closest("a")).toHaveAttribute("href", "/settings");
  });

  it("should render a Help menu item that links to /help", async () => {
    const user = userEvent.setup();
    render(
      <HeaderMenuUI>
        <MenuItem component="a" href="/help">
          <ListItemText>Help</ListItemText>
        </MenuItem>
      </HeaderMenuUI>
    );

    const avatarButton = screen.getByRole("button", { name: "Account" });
    await user.click(avatarButton);

    const helpItem = screen.getByText("Help");
    expect(helpItem).toBeInTheDocument();
    expect(helpItem.closest("a")).toHaveAttribute("href", "/help");
  });

  describe("accessibility (#797)", () => {
    it("is named by the visible user name, not a different label", () => {
      render(<HeaderMenuUI label="John Doe" />);
      expect(screen.getByRole("button", { name: "John Doe" })).toHaveAttribute(
        "aria-haspopup",
        "menu"
      );
    });

    it("falls back to the name Account with no user name", () => {
      render(<HeaderMenuUI />);
      expect(
        screen.getByRole("button", { name: "Account" })
      ).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
      const { container } = render(
        <HeaderMenuUI image="https://example.com/user.jpg" label="John Doe" />
      );
      await expectNoAxeViolations(container);
    });
  });
});
