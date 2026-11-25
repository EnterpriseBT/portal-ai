import { jest } from "@jest/globals";

const { renderHook } = await import("@testing-library/react");
const { useCommandPaletteShortcut, isPaletteShortcut, detectPlatform } =
  await import("../utils/use-command-palette-shortcut.util");

const press = (
  target: EventTarget,
  init: KeyboardEventInit = { key: "k", ctrlKey: true }
) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

const mount = (open = false, platform: "mac" | "other" = "other") => {
  const onToggle = jest.fn();
  renderHook(() => useCommandPaletteShortcut({ open, onToggle, platform }));
  return onToggle;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the palette shortcut (#1076)", () => {
  it("is Ctrl+K elsewhere and ⌘K on a Mac, never with Shift or Alt", () => {
    const k = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
    expect(isPaletteShortcut(k({ key: "k", ctrlKey: true }), "other")).toBe(
      true
    );
    expect(isPaletteShortcut(k({ key: "K", metaKey: true }), "mac")).toBe(true);
    expect(isPaletteShortcut(k({ key: "k", metaKey: true }), "other")).toBe(
      false
    );
    expect(isPaletteShortcut(k({ key: "k", ctrlKey: true }), "mac")).toBe(
      false
    );
    expect(
      isPaletteShortcut(k({ key: "k", ctrlKey: true, shiftKey: true }), "other")
    ).toBe(false);
    expect(
      isPaletteShortcut(k({ key: "k", ctrlKey: true, altKey: true }), "other")
    ).toBe(false);
  });

  it("toggles the palette and claims the key", () => {
    const onToggle = mount();
    const event = press(document.body);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("listens for ⌘K on a Mac", () => {
    const onToggle = mount(false, "mac");
    press(document.body, { key: "k", ctrlKey: true });
    expect(onToggle).not.toHaveBeenCalled();
    press(document.body, { key: "k", metaKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an input", "<input />", "input"],
    ["a textarea", "<textarea></textarea>", "textarea"],
    ["a contenteditable", '<div contenteditable="true">x</div>', "div"],
    [
      "the RegionEditor sheet",
      "<div data-sheet-surface><button>c</button></div>",
      "button",
    ],
  ])("stands down in %s", (_label, html, selector) => {
    document.body.innerHTML = html;
    const onToggle = mount();
    const event = press(document.body.querySelector(selector)!);
    expect(onToggle).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stands down while another dialog is open", () => {
    document.body.innerHTML = '<div role="dialog">Rename</div>';
    const onToggle = mount();
    press(document.body);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("closes the open palette, even from its own search field", () => {
    document.body.innerHTML = '<div role="dialog"><input /></div>';
    const onToggle = mount(true);
    press(document.body.querySelector("input")!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("ignores a key another handler already claimed", () => {
    const onToggle = mount();
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    document.body.dispatchEvent(event);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("detects a Mac", () => {
    const spy = jest
      .spyOn(navigator, "platform", "get")
      .mockReturnValue("MacIntel");
    expect(detectPlatform()).toBe("mac");
    spy.mockReturnValue("Win32");
    expect(detectPlatform()).toBe("other");
    spy.mockRestore();
  });
});
