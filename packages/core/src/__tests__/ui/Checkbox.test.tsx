import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { Checkbox } from "../../ui/Checkbox";

describe("Checkbox Component", () => {
  describe("Rendering", () => {
    it("should render without label", () => {
      render(<Checkbox />);
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });

    it("should render with label", () => {
      render(<Checkbox label="Accept terms" />);
      expect(screen.getByText("Accept terms")).toBeInTheDocument();
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });

    it("should render with helper text", () => {
      render(<Checkbox label="Newsletter" helperText="Optional" />);
      expect(screen.getByText("Optional")).toBeInTheDocument();
    });

    it("should render in checked state", () => {
      render(<Checkbox label="Checked" checked onChange={() => {}} />);
      expect(screen.getByRole("checkbox")).toBeChecked();
    });

    it("should render as disabled", () => {
      render(<Checkbox label="Disabled" disabled />);
      expect(screen.getByRole("checkbox")).toBeDisabled();
    });
  });

  describe("Interaction", () => {
    it("should call onChange with checked state when clicked", async () => {
      const handleChange = jest.fn();
      render(<Checkbox label="Toggle" onChange={handleChange} />);
      await userEvent.click(screen.getByRole("checkbox"));
      expect(handleChange).toHaveBeenCalledWith(true, expect.any(Object));
    });

    it("should pass false when unchecking", async () => {
      const handleChange = jest.fn();
      render(
        <Checkbox label="Toggle" defaultChecked onChange={handleChange} />
      );
      await userEvent.click(screen.getByRole("checkbox"));
      expect(handleChange).toHaveBeenCalledWith(false, expect.any(Object));
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the checkbox element", () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(<Checkbox ref={ref} label="Ref test" />);
      expect(ref.current).toBeTruthy();
    });
  });

  describe("Error State", () => {
    it("should display error helper text", () => {
      render(
        <Checkbox label="Required" error helperText="This field is required" />
      );
      expect(screen.getByText("This field is required")).toBeInTheDocument();
    });
  });
});
