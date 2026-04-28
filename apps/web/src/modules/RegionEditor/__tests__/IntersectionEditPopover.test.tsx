import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  IntersectionEditPopoverUI,
  type IntersectionEditPopoverUIProps,
} from "../IntersectionEditPopover.component";

function setup(overrides: Partial<IntersectionEditPopoverUIProps> = {}) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onChange = jest.fn<(value: string) => void>();
  const onClear = jest.fn();
  const onClose = jest.fn();
  const props: IntersectionEditPopoverUIProps = {
    open: true,
    anchorEl: anchor,
    label: "Region × Quarter",
    value: "",
    fallbackName: "value",
    overridden: false,
    onChange,
    onClear,
    onClose,
    ...overrides,
  };
  const utils = render(<IntersectionEditPopoverUI {...props} />);
  return { ...utils, onChange, onClear, onClose };
}

describe("IntersectionEditPopoverUI", () => {
  it("renders the composite intersection label", () => {
    setup();
    expect(screen.getByText("Region × Quarter")).toBeInTheDocument();
  });

  it("renders the cell-value input with the supplied value", () => {
    setup({ value: "revenue", overridden: true });
    expect(
      screen.getByRole("textbox", {
        name: /cell-value field name for this intersection/i,
      })
    ).toHaveValue("revenue");
  });

  it("shows the inherited fallback chip when not overridden", () => {
    setup({ overridden: false, fallbackName: "value" });
    expect(
      screen.getByText(/inherits from region.*"value"/i)
    ).toBeInTheDocument();
  });

  it("shows the overridden chip when an override is set", () => {
    setup({ overridden: true, value: "revenue" });
    expect(
      screen.getByText(/overridden — this block emits a separate field/i)
    ).toBeInTheDocument();
  });

  it("fires onChange with the typed value", () => {
    const { onChange } = setup({ value: "" });
    const input = screen.getByRole("textbox", {
      name: /cell-value field name for this intersection/i,
    });
    fireEvent.change(input, { target: { value: "revenue" } });
    expect(onChange).toHaveBeenCalledWith("revenue");
  });

  it("autofocuses the input on open", async () => {
    setup({ value: "revenue" });
    const input = screen.getByRole("textbox", {
      name: /cell-value field name for this intersection/i,
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(document.activeElement).toBe(input);
  });

  it("disables Clear override when not overridden", () => {
    setup({ overridden: false });
    expect(
      screen.getByRole("button", { name: /clear intersection override/i })
    ).toBeDisabled();
  });

  it("fires onClear when Clear override is clicked", () => {
    const { onClear } = setup({ overridden: true, value: "revenue" });
    const btn = screen.getByRole("button", {
      name: /clear intersection override/i,
    });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when Close is clicked", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
