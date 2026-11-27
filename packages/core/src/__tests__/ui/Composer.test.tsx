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

  // #1079: a field error shows under the frame and describes the field.
  it("shows an error, marks the field invalid and describes it", async () => {
    const { container } = render(
      <Composer
        aria-label="Ask a question"
        description="Enter to start"
        value={"a".repeat(10)}
        onChange={() => undefined}
        error="Question must be 20000 characters or fewer"
      />
    );
    const field = screen.getByRole("textbox", { name: "Ask a question" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "Enter to start Question must be 20000 characters or fewer"
    );
    expect(
      screen.getByText("Question must be 20000 characters or fewer")
    ).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it("is valid with no error, and never truncates with maxLength", () => {
    render(
      <Composer aria-label="Prompt" value="" onChange={() => undefined} />
    );
    const field = screen.getByRole("textbox", { name: "Prompt" });
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    expect(field).not.toHaveAttribute("maxlength");
  });

  it("reports a blur, so a form can mark the field touched (#1079)", async () => {
    const onBlur = jest.fn();
    render(
      <Composer
        aria-label="Prompt"
        value=""
        onChange={() => undefined}
        onBlur={onBlur}
      />
    );
    await userEvent.click(screen.getByRole("textbox", { name: "Prompt" }));
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
