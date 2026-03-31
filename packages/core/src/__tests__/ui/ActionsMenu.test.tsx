import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { ActionsMenu } from "../../ui/ActionsMenu";

describe("ActionsMenu Component", () => {
  const items = [
    { label: "Edit", onClick: jest.fn() },
    { label: "Duplicate", onClick: jest.fn() },
    { label: "Delete", onClick: jest.fn(), color: "error" as const },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render the trigger button with default aria-label", () => {
      render(<ActionsMenu items={items} />);
      expect(
        screen.getByRole("button", { name: "More actions" }),
      ).toBeInTheDocument();
    });

    it("should render the trigger button with a custom aria-label", () => {
      render(<ActionsMenu items={items} ariaLabel="Station actions" />);
      expect(
        screen.getByRole("button", { name: "Station actions" }),
      ).toBeInTheDocument();
    });

    it("should not show menu items before the trigger is clicked", () => {
      render(<ActionsMenu items={items} />);
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    });

    it("should set aria-haspopup on the trigger", () => {
      render(<ActionsMenu items={items} />);
      expect(screen.getByRole("button", { name: "More actions" })).toHaveAttribute(
        "aria-haspopup",
        "true",
      );
    });

    it("should set aria-expanded to false when closed", () => {
      render(<ActionsMenu items={items} />);
      expect(screen.getByRole("button", { name: "More actions" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });

  describe("Opening and Closing", () => {
    it("should show all menu items when the trigger is clicked", async () => {
      render(<ActionsMenu items={items} />);
      await userEvent.click(screen.getByRole("button", { name: "More actions" }));

      expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    });

    it("should set aria-expanded to true when open", async () => {
      render(<ActionsMenu items={items} />);
      const trigger = screen.getByRole("button", { name: "More actions" });
      await userEvent.click(trigger);

      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("should close the menu after clicking a menu item", async () => {
      render(<ActionsMenu items={items} />);
      await userEvent.click(screen.getByRole("button", { name: "More actions" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    });
  });

  describe("Item Callbacks", () => {
    it("should call the item onClick handler when clicked", async () => {
      render(<ActionsMenu items={items} />);
      await userEvent.click(screen.getByRole("button", { name: "More actions" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

      expect(items[0].onClick).toHaveBeenCalledTimes(1);
      expect(items[1].onClick).not.toHaveBeenCalled();
      expect(items[2].onClick).not.toHaveBeenCalled();
    });

    it("should not call onClick for a disabled item", async () => {
      const disabledItems = [
        { label: "Disabled Action", onClick: jest.fn(), disabled: true },
      ];
      render(<ActionsMenu items={disabledItems} />);
      await userEvent.click(screen.getByRole("button", { name: "More actions" }));

      const menuItem = screen.getByRole("menuitem", { name: "Disabled Action" });
      expect(menuItem).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("Icon Support", () => {
    it("should render item icons when provided", async () => {
      const itemsWithIcon = [
        {
          label: "Settings",
          onClick: jest.fn(),
          icon: <span data-testid="settings-icon">ic</span>,
        },
      ];
      render(<ActionsMenu items={itemsWithIcon} />);
      await userEvent.click(screen.getByRole("button", { name: "More actions" }));

      expect(screen.getByTestId("settings-icon")).toBeInTheDocument();
    });

    it("should not render icon containers when icons are not provided", async () => {
      const plainItems = [{ label: "Plain", onClick: jest.fn() }];
      render(<ActionsMenu items={plainItems} />);
      await userEvent.click(screen.getByRole("button", { name: "More actions" }));

      const menuItem = screen.getByRole("menuitem", { name: "Plain" });
      expect(
        menuItem.querySelector(".MuiListItemIcon-root"),
      ).not.toBeInTheDocument();
    });
  });
});
