import type React from "react";

import { isDialogControlBlur } from "../utils/dialog-blur.util";

const blurTo = (relatedTarget: Element | null) =>
  ({ relatedTarget }) as unknown as React.FocusEvent;

describe("isDialogControlBlur (#789)", () => {
  const build = () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div data-dialog-controls><button id="close">x</button></div>
        <input id="name" /><input id="other" />
        <div data-dialog-controls><button id="cancel">Cancel</button></div>
      </div>`;
    return (id: string) => document.getElementById(id)!;
  };

  it("is true when focus moves to an action button", () => {
    const el = build();
    expect(isDialogControlBlur(blurTo(el("cancel")))).toBe(true);
  });

  it("is true when focus moves to a header control", () => {
    const el = build();
    expect(isDialogControlBlur(blurTo(el("close")))).toBe(true);
  });

  it("is false when focus moves to another field", () => {
    const el = build();
    expect(isDialogControlBlur(blurTo(el("other")))).toBe(false);
  });

  it("is false when focus leaves for nowhere (a click on empty space)", () => {
    build();
    expect(isDialogControlBlur(blurTo(null))).toBe(false);
  });
});
