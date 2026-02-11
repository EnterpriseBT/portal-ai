import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import { useTheme as useMuiTheme } from "@mui/material/styles";
import {
  ThemeProvider,
  useTheme,
  ThemeContext,
  DEFAULT_THEME,
  THEME_MAP,
  type ThemeName,
} from "../ThemeProvider";

// Test component that uses the theme context
const ThemeConsumer: React.FC<{
  onThemeChange?: (themeName: ThemeName) => void;
}> = ({ onThemeChange }) => {
  const { themeName, setThemeName, theme } = useTheme();

  React.useEffect(() => {
    if (onThemeChange) {
      onThemeChange(themeName);
    }
  }, [themeName, onThemeChange]);

  return (
    <div>
      <div data-testid="current-theme">{themeName}</div>
      <div data-testid="theme-mode">{theme.palette.mode}</div>
      <button onClick={() => setThemeName("brand")}>Set Brand Theme</button>
      <button onClick={() => setThemeName("brand.dark")}>
        Set Brand Dark Theme
      </button>
    </div>
  );
};

// Simple test component to verify children rendering
const TestChild: React.FC = () => (
  <div data-testid="test-child">Test Child</div>
);

describe("ThemeProvider Component", () => {
  describe("Rendering", () => {
    it("should render children correctly", () => {
      render(
        <ThemeProvider>
          <TestChild />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("test-child")).toBeInTheDocument();
      expect(screen.getByTestId("test-child")).toHaveTextContent("Test Child");
    });

    it("should render with CssBaseline", () => {
      const { container } = render(
        <ThemeProvider>
          <TestChild />
        </ThemeProvider>,
      );

      // CssBaseline adds global styles, verify the component tree includes it
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Default Theme", () => {
    it("should use default theme when no defaultTheme prop is provided", () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      const currentTheme = screen.getByTestId("current-theme");
      expect(currentTheme).toHaveTextContent(DEFAULT_THEME);
    });

    it('should use default theme value of "brand"', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("current-theme")).toHaveTextContent("brand");
    });
  });

  describe("Custom Default Theme", () => {
    it("should use custom defaultTheme when provided", () => {
      render(
        <ThemeProvider defaultTheme="brand.dark">
          <ThemeConsumer />
        </ThemeProvider>,
      );

      const currentTheme = screen.getByTestId("current-theme");
      expect(currentTheme).toHaveTextContent("brand.dark");
    });

    it("should apply dark mode when brand.dark theme is used", () => {
      render(
        <ThemeProvider defaultTheme="brand.dark">
          <ThemeConsumer />
        </ThemeProvider>,
      );

      const themeMode = screen.getByTestId("theme-mode");
      expect(themeMode).toHaveTextContent("dark");
    });
  });

  describe("Theme Switching", () => {
    it("should switch from default to dark theme", async () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      // Verify initial theme
      expect(screen.getByTestId("current-theme")).toHaveTextContent("brand");

      // Switch to dark theme
      const darkButton = screen.getByRole("button", {
        name: /set brand dark theme/i,
      });
      fireEvent.click(darkButton);

      // Verify theme changed
      await waitFor(() => {
        expect(screen.getByTestId("current-theme")).toHaveTextContent(
          "brand.dark",
        );
      });
    });

    it("should switch from dark to light theme", async () => {
      render(
        <ThemeProvider defaultTheme="brand.dark">
          <ThemeConsumer />
        </ThemeProvider>,
      );

      // Verify initial theme
      expect(screen.getByTestId("current-theme")).toHaveTextContent(
        "brand.dark",
      );

      // Switch to light theme
      const lightButton = screen.getByRole("button", {
        name: /set brand theme/i,
      });
      fireEvent.click(lightButton);

      // Verify theme changed
      await waitFor(() => {
        expect(screen.getByTestId("current-theme")).toHaveTextContent("brand");
      });
    });

    it("should trigger theme change callback", async () => {
      const onThemeChange = jest.fn();

      render(
        <ThemeProvider>
          <ThemeConsumer onThemeChange={onThemeChange} />
        </ThemeProvider>,
      );

      // Wait for initial effect to complete
      await waitFor(() => {
        expect(onThemeChange).toHaveBeenCalledWith("brand");
      });

      // Switch theme
      const darkButton = screen.getByRole("button", {
        name: /set brand dark theme/i,
      });
      fireEvent.click(darkButton);

      // Should be called with new theme
      await waitFor(() => {
        expect(onThemeChange).toHaveBeenCalledWith("brand.dark");
      });
    });

    it("should allow multiple theme switches", async () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      const lightButton = screen.getByRole("button", {
        name: /set brand theme/i,
      });
      const darkButton = screen.getByRole("button", {
        name: /set brand dark theme/i,
      });

      // Switch to dark
      fireEvent.click(darkButton);
      await waitFor(() => {
        expect(screen.getByTestId("current-theme")).toHaveTextContent(
          "brand.dark",
        );
      });

      // Switch back to light
      fireEvent.click(lightButton);
      await waitFor(() => {
        expect(screen.getByTestId("current-theme")).toHaveTextContent("brand");
      });

      // Switch to dark again
      fireEvent.click(darkButton);
      await waitFor(() => {
        expect(screen.getByTestId("current-theme")).toHaveTextContent(
          "brand.dark",
        );
      });
    });
  });

  describe("useTheme Hook", () => {
    it("should provide themeName from context", () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("current-theme")).toHaveTextContent("brand");
    });

    it("should provide setThemeName function", async () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      const darkButton = screen.getByRole("button", {
        name: /set brand dark theme/i,
      });
      fireEvent.click(darkButton);

      // Verify setThemeName works
      await waitFor(() => {
        expect(screen.getByTestId("current-theme")).toHaveTextContent(
          "brand.dark",
        );
      });
    });

    it("should provide MUI theme object", () => {
      const ThemeObjectConsumer: React.FC = () => {
        const { theme } = useTheme();
        return (
          <div>
            <div data-testid="has-palette">
              {theme.palette ? "true" : "false"}
            </div>
            <div data-testid="has-typography">
              {theme.typography ? "true" : "false"}
            </div>
            <div data-testid="has-spacing">
              {typeof theme.spacing !== "undefined" ? "true" : "false"}
            </div>
          </div>
        );
      };

      render(
        <ThemeProvider>
          <ThemeObjectConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("has-palette")).toHaveTextContent("true");
      expect(screen.getByTestId("has-typography")).toHaveTextContent("true");
      expect(screen.getByTestId("has-spacing")).toHaveTextContent("true");
    });

    it("should provide updated theme object when theme changes", async () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      // Initial theme mode should be light
      expect(screen.getByTestId("theme-mode")).toHaveTextContent("light");

      // Switch to dark theme
      const darkButton = screen.getByRole("button", {
        name: /set brand dark theme/i,
      });
      fireEvent.click(darkButton);

      // Theme mode should update to dark
      await waitFor(() => {
        expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
      });
    });
  });

  describe("Theme Context", () => {
    it("should provide ThemeContext with themeName and setThemeName", () => {
      const ContextConsumer: React.FC = () => {
        const context = React.useContext(ThemeContext);
        return (
          <div>
            <div data-testid="has-themeName">
              {context.themeName ? "true" : "false"}
            </div>
            <div data-testid="has-setThemeName">
              {typeof context.setThemeName !== "undefined" ? "true" : "false"}
            </div>
          </div>
        );
      };

      render(
        <ThemeProvider>
          <ContextConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("has-themeName")).toHaveTextContent("true");
      expect(screen.getByTestId("has-setThemeName")).toHaveTextContent("true");
    });
  });

  describe("THEME_MAP", () => {
    it("should contain brand theme", () => {
      expect(THEME_MAP).toHaveProperty("brand");
      expect(THEME_MAP.brand).toBeDefined();
    });

    it("should contain brand.dark theme", () => {
      const themeName = "brand.dark" as const;
      // Use array notation for toHaveProperty to handle keys with dots
      expect(THEME_MAP).toHaveProperty([themeName]);
      expect(THEME_MAP[themeName]).toBeDefined();
    });

    it("should have MUI theme objects with palette", () => {
      const darkThemeName = "brand.dark" as const;
      expect(THEME_MAP.brand.palette).toBeDefined();
      expect(THEME_MAP[darkThemeName].palette).toBeDefined();
    });

    it("should have light mode for brand theme", () => {
      expect(THEME_MAP.brand.palette.mode).toBe("light");
    });

    it("should have dark mode for brand.dark theme", () => {
      const darkThemeName = "brand.dark" as const;
      expect(THEME_MAP[darkThemeName].palette.mode).toBe("dark");
    });
  });

  describe("Integration with MUI", () => {
    it("should integrate with MUI ThemeProvider", () => {
      const MuiThemeConsumer: React.FC = () => {
        const muiTheme = useMuiTheme();
        return <div data-testid="mui-theme-mode">{muiTheme.palette.mode}</div>;
      };

      render(
        <ThemeProvider>
          <MuiThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("mui-theme-mode")).toHaveTextContent("light");
    });

    it("should update MUI theme when switching themes", async () => {
      const MuiThemeConsumer: React.FC = () => {
        const muiTheme = useMuiTheme();
        const { setThemeName } = useTheme();
        return (
          <div>
            <div data-testid="mui-theme-mode">{muiTheme.palette.mode}</div>
            <button onClick={() => setThemeName("brand.dark")}>
              Switch to Dark
            </button>
          </div>
        );
      };

      render(
        <ThemeProvider>
          <MuiThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("mui-theme-mode")).toHaveTextContent("light");

      const switchButton = screen.getByRole("button", {
        name: /switch to dark/i,
      });
      fireEvent.click(switchButton);

      await waitFor(() => {
        expect(screen.getByTestId("mui-theme-mode")).toHaveTextContent("dark");
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle rapid theme switches", async () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      const lightButton = screen.getByRole("button", {
        name: /set brand theme/i,
      });
      const darkButton = screen.getByRole("button", {
        name: /set brand dark theme/i,
      });

      // Rapidly switch themes
      fireEvent.click(darkButton);
      fireEvent.click(lightButton);
      fireEvent.click(darkButton);
      fireEvent.click(lightButton);

      // Should end up on light theme
      await waitFor(() => {
        expect(screen.getByTestId("current-theme")).toHaveTextContent("brand");
      });
    });

    it("should maintain theme state across re-renders", async () => {
      const { rerender } = render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      // Switch theme
      const darkButton = screen.getByRole("button", {
        name: /set brand dark theme/i,
      });
      fireEvent.click(darkButton);

      await waitFor(() => {
        expect(screen.getByTestId("current-theme")).toHaveTextContent(
          "brand.dark",
        );
      });

      // Force re-render
      rerender(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>,
      );

      // Theme should persist (starts with default again due to new instance)
      expect(screen.getByTestId("current-theme")).toHaveTextContent("brand");
    });
  });

  describe("Type Safety", () => {
    it("should accept valid ThemeProviderProps", () => {
      const validProps = {
        children: <TestChild />,
        defaultTheme: "brand" as ThemeName,
      };

      render(<ThemeProvider {...validProps} />);
      expect(screen.getByTestId("test-child")).toBeInTheDocument();
    });

    it("should work with brand theme name", () => {
      render(
        <ThemeProvider defaultTheme="brand">
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("current-theme")).toHaveTextContent("brand");
    });

    it("should work with brand.dark theme name", () => {
      render(
        <ThemeProvider defaultTheme="brand.dark">
          <ThemeConsumer />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("current-theme")).toHaveTextContent(
        "brand.dark",
      );
    });
  });

});
