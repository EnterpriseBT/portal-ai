import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { DeferredTextInput } from "../../ui/DeferredTextInput";

describe("DeferredTextInput", () => {
  it("renders with label and value", () => {
    render(<DeferredTextInput label="Name" value="Alice" onChange={jest.fn()} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Alice");
  });

  it("updates local value on typing without calling onChange", async () => {
    const handleChange = jest.fn();
    render(<DeferredTextInput label="Name" value="Alice" onChange={handleChange} />);
    const input = screen.getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "Bob");
    expect(input).toHaveValue("Bob");
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("calls onChange on blur when value has changed", async () => {
    const handleChange = jest.fn();
    render(<DeferredTextInput label="Name" value="Alice" onChange={handleChange} />);
    const input = screen.getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "Bob");
    await userEvent.tab();
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it("does not call onChange on blur when value is unchanged", async () => {
    const handleChange = jest.fn();
    render(<DeferredTextInput label="Name" value="Alice" onChange={handleChange} />);
    const input = screen.getByLabelText("Name");
    input.focus();
    await userEvent.tab();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("syncs local value when external value prop changes", () => {
    const { rerender } = render(
      <DeferredTextInput label="Name" value="Alice" onChange={jest.fn()} />
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Alice");
    rerender(<DeferredTextInput label="Name" value="Bob" onChange={jest.fn()} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Bob");
  });

  it("calls onBlur prop in addition to deferred onChange", async () => {
    const handleChange = jest.fn();
    const handleBlur = jest.fn();
    render(
      <DeferredTextInput label="Name" value="Alice" onChange={handleChange} onBlur={handleBlur} />
    );
    const input = screen.getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "Bob");
    await userEvent.tab();
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleBlur).toHaveBeenCalledTimes(1);
  });

  it("forwards ref to the underlying div element", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<DeferredTextInput ref={ref} label="Ref test" value="" onChange={jest.fn()} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("renders as disabled", () => {
    render(<DeferredTextInput label="Disabled" value="" onChange={jest.fn()} disabled />);
    expect(screen.getByLabelText("Disabled")).toBeDisabled();
  });

  it("renders helper text", () => {
    render(
      <DeferredTextInput label="Name" value="" onChange={jest.fn()} helperText="Enter your name" />
    );
    expect(screen.getByText("Enter your name")).toBeInTheDocument();
  });
});
