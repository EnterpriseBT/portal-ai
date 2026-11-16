import { jest } from "@jest/globals";

import {
  render,
  screen,
  expectNoAxeViolations,
} from "../../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { DiscardImportDialogUI } from "../DiscardImportDialog.component";

function setup(open = true) {
  const onKeepEditing = jest.fn();
  const onDiscard = jest.fn();
  render(
    <DiscardImportDialogUI
      open={open}
      onKeepEditing={onKeepEditing}
      onDiscard={onDiscard}
    />
  );
  return { onKeepEditing, onDiscard };
}

describe("DiscardImportDialogUI (#795)", () => {
  test("renders its title and message when open", async () => {
    setup();
    const dialog = await screen.findByRole("dialog", {
      name: "Discard this import?",
    });
    expect(dialog).toHaveAccessibleDescription(
      "The regions you've drawn and their settings will be lost."
    );
  });

  test("renders nothing when closed", () => {
    setup(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Keep editing has focus, so Enter keeps editing", async () => {
    const { onKeepEditing, onDiscard } = setup();
    const keep = screen.getByRole("button", { name: "Keep editing" });
    await screen.findByRole("dialog");
    await new Promise((r) => setTimeout(r, 80));
    expect(keep).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  test("Escape keeps editing", async () => {
    const { onKeepEditing, onDiscard } = setup();
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  test("Discard discards", async () => {
    const { onDiscard } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  test("has no axe violations when open", async () => {
    setup();
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });
});
