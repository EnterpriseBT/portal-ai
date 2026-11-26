import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { Composer } from "../../ui/Composer";
import { expectNoAxeViolations } from "../axe.util";

const Controlled: React.FC<{
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
}> = ({ onKeyDown }) => {
  const [value, setValue] = useState("");
  return (
    <Composer
      aria-label="Ask a question"
      placeholder="Ask anything about your data…"
      description="Enter to start, Shift+Enter for a new line"
      value={value}
      onChange={setValue}
      onKeyDown={onKeyDown}
      actions={<button type="button">Start</button>}
    />
  );
};

describe("Composer", () => {
  it("is a named, described text field with its actions beside it", async () => {
    const { container } = render(<Controlled />);
    const field = screen.getByRole("textbox", { name: "Ask a question" });
    expect(field).toHaveAccessibleDescription(
      "Enter to start, Shift+Enter for a new line"
    );
    expect(field).toHaveAttribute(
      "placeholder",
      "Ask anything about your data…"
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("reports what's typed and passes key presses through", async () => {
    const user = userEvent.setup();
    const onKeyDown = jest.fn();
    render(<Controlled onKeyDown={onKeyDown} />);
    const field = screen.getByRole("textbox", { name: "Ask a question" });
    await user.type(field, "Hi");
    expect(field).toHaveValue("Hi");
    expect(onKeyDown).toHaveBeenCalled();
  });

  it("has no description when none is given", () => {
    render(
      <Composer aria-label="Prompt" value="" onChange={() => undefined} />
    );
    expect(screen.getByRole("textbox", { name: "Prompt" })).not.toHaveAttribute(
      "aria-describedby"
    );
  });
});
