import React from "react";
import ReactDOM from "react-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { handleOwnSubmit } from "../../ui/handle-own-submit";

// #789: a form's onSubmit acts only on its own submit. React bubbles a
// portaled child form's submit (a nested dialog or popover) to its ancestors'
// handlers, which would otherwise fire the parent's action too.
describe("handleOwnSubmit", () => {
  it("runs on its own form's submit and prevents the page submit", async () => {
    const user = userEvent.setup();
    const run = jest.fn();
    render(
      <form onSubmit={handleOwnSubmit(run)}>
        <input aria-label="field" />
      </form>
    );
    await user.type(screen.getByLabelText("field"), "x{Enter}");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a submit bubbled from a portaled child form", async () => {
    const user = userEvent.setup();
    const run = jest.fn();
    const child = jest.fn((e: React.FormEvent) => e.preventDefault());
    const Child = () =>
      ReactDOM.createPortal(
        <form onSubmit={child}>
          <input aria-label="child" />
        </form>,
        document.body
      );
    render(
      <form onSubmit={handleOwnSubmit(run)}>
        <Child />
      </form>
    );
    await user.type(screen.getByLabelText("child"), "x{Enter}");
    expect(child).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves a bubbled submit's default to the child that owns it", () => {
    const run = jest.fn();
    const handler = handleOwnSubmit(run);
    const preventDefault = jest.fn();
    const own = document.createElement("form");
    const child = document.createElement("form");
    handler({
      target: child,
      currentTarget: own,
      preventDefault,
    } as unknown as React.FormEvent<HTMLFormElement>);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
