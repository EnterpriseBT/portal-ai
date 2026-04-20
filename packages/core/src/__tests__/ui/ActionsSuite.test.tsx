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

    it("should render disabled buttons", () => {
      const disabledItems = [
        { label: "Archive", onClick: jest.fn(), disabled: true },
      ];
      render(<ActionsSuite items={disabledItems} />);
      expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
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

    it("should not allow interaction on a disabled button", () => {
      const disabledItems = [
        { label: "Archive", onClick: jest.fn(), disabled: true },
      ];
      render(<ActionsSuite items={disabledItems} />);

      expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
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
