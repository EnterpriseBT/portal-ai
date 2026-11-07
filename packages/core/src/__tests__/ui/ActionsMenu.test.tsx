import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { ActionsMenu } from "../../ui/ActionsMenu";
import { Modal } from "../../ui/Modal";
import { expectNoAxeViolations } from "../axe.util";

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
        screen.getByRole("button", { name: "More actions" })
      ).toBeInTheDocument();
    });

    it("should render the trigger button with a custom aria-label", () => {
      render(<ActionsMenu items={items} ariaLabel="Station actions" />);
      expect(
        screen.getByRole("button", { name: "Station actions" })
      ).toBeInTheDocument();
    });

    it("should not show menu items before the trigger is clicked", () => {
      render(<ActionsMenu items={items} />);
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    });

    it("should set aria-haspopup on the trigger", () => {
      render(<ActionsMenu items={items} />);
      expect(
        screen.getByRole("button", { name: "More actions" })
      ).toHaveAttribute("aria-haspopup", "true");
    });

    it("should set aria-expanded to false when closed", () => {
      render(<ActionsMenu items={items} />);
      expect(
        screen.getByRole("button", { name: "More actions" })
      ).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("Opening and Closing", () => {
    it("should show all menu items when the trigger is clicked", async () => {
      render(<ActionsMenu items={items} />);
      await userEvent.click(
        screen.getByRole("button", { name: "More actions" })
      );

      expect(
        screen.getByRole("menuitem", { name: "Edit" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Duplicate" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Delete" })
      ).toBeInTheDocument();
    });

    it("should set aria-expanded to true when open", async () => {
      render(<ActionsMenu items={items} />);
      const trigger = screen.getByRole("button", { name: "More actions" });
      await userEvent.click(trigger);

      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("should close the menu after clicking a menu item", async () => {
      render(<ActionsMenu items={items} />);
      await userEvent.click(
        screen.getByRole("button", { name: "More actions" })
      );
      await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    });
  });

  describe("Item Callbacks", () => {
    it("should call the item onClick handler when clicked", async () => {
      render(<ActionsMenu items={items} />);
      await userEvent.click(
        screen.getByRole("button", { name: "More actions" })
      );
      await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

      expect(items[0].onClick).toHaveBeenCalledTimes(1);
      expect(items[1].onClick).not.toHaveBeenCalled();
      expect(items[2].onClick).not.toHaveBeenCalled();
    });
  });

  // #688: items render an ActionGate decided by the app.
  describe("Gates (#688)", () => {
    const open = async () =>
      userEvent.click(screen.getByRole("button", { name: "More actions" }));

    it("drops hidden items", async () => {
      render(
        <ActionsMenu
          items={[
            { label: "Edit", onClick: jest.fn() },
            { label: "Delete", onClick: jest.fn(), gate: { kind: "hide" } },
          ]}
        />
      );
      await open();
      expect(
        screen.getByRole("menuitem", { name: "Edit" })
      ).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });

    it("renders no trigger when every item is hidden", () => {
      render(
        <ActionsMenu
          items={[
            { label: "Edit", onClick: jest.fn(), gate: { kind: "hide" } },
            { label: "Delete", onClick: jest.fn(), gate: { kind: "hide" } },
          ]}
        />
      );
      expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    });

    it("a disabled item is aria-disabled, focusable, shows its reason, and does nothing on click", async () => {
      const onClick = jest.fn();
      render(
        <ActionsMenu
          items={[
            {
              label: "Sync",
              onClick,
              gate: { kind: "disable", reason: "A sync is already running" },
            },
          ]}
        />
      );
      await open();
      const item = screen.getByRole("menuitem", { name: "Sync" });
      expect(item).toHaveAttribute("aria-disabled", "true");
      await userEvent.hover(item);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "A sync is already running"
      );
      await userEvent.click(item);
      expect(onClick).not.toHaveBeenCalled();
      // The menu stays open on a refused click.
      expect(
        screen.getByRole("menuitem", { name: "Sync" })
      ).toBeInTheDocument();
    });

    it("an upsell item calls onUpgrade instead of onClick", async () => {
      const onClick = jest.fn();
      const onUpgrade = jest.fn();
      render(
        <ActionsMenu
          items={[
            {
              label: "Register toolpack",
              onClick,
              gate: { kind: "upsell", reason: "On a higher plan", onUpgrade },
            },
          ]}
        />
      );
      await open();
      await userEvent.click(
        screen.getByRole("menuitem", { name: /Register toolpack/ })
      );
      expect(onUpgrade).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("an omitted gate behaves as allow", async () => {
      const onClick = jest.fn();
      render(<ActionsMenu items={[{ label: "Edit", onClick }]} />);
      await open();
      await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
      expect(onClick).toHaveBeenCalledTimes(1);
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
      await userEvent.click(
        screen.getByRole("button", { name: "More actions" })
      );

      expect(screen.getByTestId("settings-icon")).toBeInTheDocument();
    });

    it("should not render icon containers when icons are not provided", async () => {
      const plainItems = [{ label: "Plain", onClick: jest.fn() }];
      render(<ActionsMenu items={plainItems} />);
      await userEvent.click(
        screen.getByRole("button", { name: "More actions" })
      );

      const menuItem = screen.getByRole("menuitem", { name: "Plain" });
      expect(
        menuItem.querySelector(".MuiListItemIcon-root")
      ).not.toBeInTheDocument();
    });
  });
});

// #793: a dialog opened from a menu item returns focus to the menu's button
// when it closes; the item it was opened from is gone by then.
describe("ActionsMenu focus (#793)", () => {
  const Harness = () => {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <ActionsMenu
          items={[{ label: "Rename", onClick: () => setOpen(true) }]}
        />
        <Modal open={open} onClose={() => setOpen(false)} title="Rename">
          <p>Body</p>
        </Modal>
      </>
    );
  };

  it("returns focus to the menu button after a dialog it opened closes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename" });
    await user.click(within(dialog).getByRole("button", { name: "close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("returns focus to the menu button with the keyboard too", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: "Rename" });
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Rename" });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

/** The text of the elements an aria-describedby names (#793): the reason
 *  must be a permanent description, not the tooltip's `title` fallback. */
const describedByText = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("ActionsMenu reasons (#793)", () => {
  const items = [
    {
      label: "Sync",
      onClick: () => {},
      gate: { kind: "disable", reason: "A sync is already running" },
    },
    {
      label: "Export",
      onClick: () => {},
      gate: {
        kind: "upsell",
        reason: "Exports are on a higher plan",
        onUpgrade: () => {},
      },
    },
    { label: "Rename", onClick: () => {} },
  ] as const;

  const openMenu = async () => {
    render(<ActionsMenu items={[...items]} />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  };

  it("describes each gated item by its reason, keeping its name", async () => {
    await openMenu();
    const sync = screen.getByRole("menuitem", { name: "Sync" });
    const exportItem = screen.getByRole("menuitem", { name: "Export" });
    expect(describedByText(sync)).toBe("A sync is already running");
    expect(describedByText(exportItem)).toBe("Exports are on a higher plan");
    expect(sync).toHaveAccessibleDescription("A sync is already running");
    expect(
      screen.getByRole("menuitem", { name: "Rename" })
    ).not.toHaveAttribute("aria-describedby");
  });

  it("a disabled item adds no styles of its own (the theme owns the look)", async () => {
    await openMenu();
    const sync = screen.getByRole("menuitem", { name: "Sync" });
    const rename = screen.getByRole("menuitem", { name: "Rename" });
    // Same Emotion rule as an ungated item: no sx. (Focus state aside.)
    const emotion = (el: HTMLElement) =>
      [...el.classList].filter((c) => c.startsWith("css-"));
    expect(emotion(sync)).toEqual(emotion(rename));
  });

  it("has no axe violations when open", async () => {
    await openMenu();
    await expectNoAxeViolations(screen.getByRole("menu"));
  });
});
