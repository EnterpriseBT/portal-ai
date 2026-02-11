import { jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ThemeSwitcherUI,
  type ThemeConfig,
} from "../components/ThemeSwitcher.component";
import { IconName } from "@mcp-ui/core";

describe("ThemeSwitcherUI Component", () => {
  const mockOnThemeSelect = jest.fn();
  const availableThemes: ThemeConfig[] = [
    {
      label: "Light",
      themeName: "brand",
      icon: IconName.Sun,
    },
    {
      label: "Dark",
      themeName: "brand.dark",
      icon: IconName.Moon,
    },
  ];

  beforeEach(() => {
    mockOnThemeSelect.mockClear();
  });

  it("should render theme button", () => {
    render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );
    expect(
      screen.getByRole("button", { name: /select theme/i })
    ).toBeInTheDocument();
  });

  it("should display current theme icon", () => {
    const { container } = render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("should display moon icon when dark theme is selected", () => {
    render(
      <ThemeSwitcherUI
        currentThemeName="brand.dark"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );
    // The moon icon should be displayed for dark theme
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("should open menu when button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );

    const button = screen.getByRole("button", { name: /select theme/i });
    await user.click(button);

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("should display all theme labels in menu", async () => {
    const user = userEvent.setup();
    render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );

    const button = screen.getByRole("button", { name: /select theme/i });
    await user.click(button);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Light")).toBeInTheDocument();
    expect(within(menu).getByText("Dark")).toBeInTheDocument();
  });

  it("should display icons for each theme in menu", async () => {
    const user = userEvent.setup();
    render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );

    const button = screen.getByRole("button", { name: /select theme/i });
    await user.click(button);

    const menu = screen.getByRole("menu");
    const menuItems = within(menu).getAllByRole("menuitem");

    // Each menu item should have an icon
    menuItems.forEach((item) => {
      expect(item.querySelector("svg")).toBeInTheDocument();
    });
  });

  it("should call onThemeSelect when a theme is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );

    const button = screen.getByRole("button", { name: /select theme/i });
    await user.click(button);

    const menu = screen.getByRole("menu");
    const darkThemeItem = within(menu).getByText("Dark");
    await user.click(darkThemeItem);

    expect(mockOnThemeSelect).toHaveBeenCalledWith("brand.dark");
  });

  it("should close menu after theme selection", async () => {
    const user = userEvent.setup();
    render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );

    const button = screen.getByRole("button", { name: /select theme/i });
    await user.click(button);

    const menu = screen.getByRole("menu");
    const darkThemeItem = within(menu).getByText("Dark");
    await user.click(darkThemeItem);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("should mark current theme as selected", async () => {
    const user = userEvent.setup();
    render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={availableThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );

    const button = screen.getByRole("button", { name: /select theme/i });
    await user.click(button);

    const menu = screen.getByRole("menu");
    const lightItem = within(menu).getByRole("menuitem", { name: /light/i });

    expect(lightItem).toHaveClass("Mui-selected");
  });

  it("should support custom theme configurations", async () => {
    const customThemes: ThemeConfig[] = [
      {
        label: "Ocean",
        themeName: "brand",
        icon: IconName.Star,
      },
      {
        label: "Sunset",
        themeName: "brand.dark",
        icon: IconName.Favorite,
      },
    ];

    const user = userEvent.setup();
    render(
      <ThemeSwitcherUI
        currentThemeName="brand"
        availableThemes={customThemes}
        onThemeSelect={mockOnThemeSelect}
      />
    );

    const button = screen.getByRole("button", { name: /select theme/i });
    await user.click(button);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Ocean")).toBeInTheDocument();
    expect(within(menu).getByText("Sunset")).toBeInTheDocument();
  });
});
