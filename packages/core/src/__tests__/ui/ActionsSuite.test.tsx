import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { ActionsSuite } from "../../ui/ActionsSuite";

describe("ActionsSuite Component", () => {
  const items = [
    { label: "Edit", onClick: jest.fn() },
    { label: "Duplicate", onClick: jest.fn() },
    { label: "Delete", onClick: jest.fn(), color: "error" as const },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render all action buttons", () => {
      render(<ActionsSuite items={items} />);
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Duplicate" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Delete" })
      ).toBeInTheDocument();
    });

    it("should render nothing when items is empty", () => {
      const { container } = render(<ActionsSuite items={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("should render icons when provided", () => {
      const itemsWithIcon = [
        {
          label: "Settings",
          onClick: jest.fn(),
          icon: <span data-testid="settings-icon">ic</span>,
        },
      ];
      render(<ActionsSuite items={itemsWithIcon} />);
      expect(screen.getByTestId("settings-icon")).toBeInTheDocument();
    });

    it("#688: renders a disable gate aria-disabled with its reason, and swallows the click", async () => {
      const onClick = jest.fn();
      render(
        <ActionsSuite
          items={[
            {
              label: "Archive",
              onClick,
              gate: { kind: "disable", reason: "An import is running" },
            },
          ]}
        />
      );
      const button = screen.getByRole("button", { name: "Archive" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("#688: drops hidden items, and renders nothing when all are hidden", () => {
      const { container, rerender } = render(
        <ActionsSuite
          items={[
            { label: "Share", onClick: jest.fn(), gate: { kind: "hide" } },
            { label: "Delete", onClick: jest.fn() },
          ]}
        />
      );
      expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Delete" })
      ).toBeInTheDocument();
      rerender(
        <ActionsSuite
          items={[
            { label: "Share", onClick: jest.fn(), gate: { kind: "hide" } },
          ]}
        />
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("#688: an upsell item calls onUpgrade", async () => {
      const onUpgrade = jest.fn();
      render(
        <ActionsSuite
          items={[
            {
              label: "Register",
              onClick: jest.fn(),
              gate: { kind: "upsell", reason: "On a higher plan", onUpgrade },
            },
          ]}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: /Register/ }));
      expect(onUpgrade).toHaveBeenCalledTimes(1);
    });

    it("should default to outlined variant", () => {
      render(<ActionsSuite items={[{ label: "Edit", onClick: jest.fn() }]} />);
      const button = screen.getByRole("button", { name: "Edit" });
      expect(button).toHaveClass("MuiButton-outlined");
    });

    it("should apply the specified variant per item", () => {
      const mixedItems = [
        { label: "Primary", onClick: jest.fn(), variant: "contained" as const },
        { label: "Secondary", onClick: jest.fn(), variant: "text" as const },
      ];
      render(<ActionsSuite items={mixedItems} />);
      expect(screen.getByRole("button", { name: "Primary" })).toHaveClass(
        "MuiButton-contained"
      );
      expect(screen.getByRole("button", { name: "Secondary" })).toHaveClass(
        "MuiButton-text"
      );
    });

    it("should apply the size prop to all buttons", () => {
      render(
        <ActionsSuite
          items={[{ label: "Edit", onClick: jest.fn() }]}
          size="medium"
        />
      );
      expect(screen.getByRole("button", { name: "Edit" })).toHaveClass(
        "MuiButton-sizeMedium"
      );
    });

    it("should default to small size", () => {
      render(<ActionsSuite items={[{ label: "Edit", onClick: jest.fn() }]} />);
      expect(screen.getByRole("button", { name: "Edit" })).toHaveClass(
        "MuiButton-sizeSmall"
      );
    });
  });

  describe("Interactions", () => {
    it("should call onClick when a button is clicked", async () => {
      render(<ActionsSuite items={items} />);
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));

      expect(items[0].onClick).toHaveBeenCalledTimes(1);
      expect(items[1].onClick).not.toHaveBeenCalled();
      expect(items[2].onClick).not.toHaveBeenCalled();
    });
  });

  describe("Props", () => {
    it("should accept a custom className", () => {
      const { container } = render(
        <ActionsSuite items={items} className="custom-suite" />
      );
      expect(container.firstChild).toHaveClass("custom-suite");
    });

    it("should accept custom data attributes", () => {
      render(<ActionsSuite items={items} data-testid="actions-suite" />);
      expect(screen.getByTestId("actions-suite")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the root element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<ActionsSuite ref={ref} items={items} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});
