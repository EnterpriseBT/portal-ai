import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { Select } from "../../ui/Select";

const options = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
  { value: "c", label: "Option C" },
];

describe("Select Component", () => {
  describe("Rendering", () => {
    it("should render with label", () => {
      render(<Select label="Choice" options={options} value="" />);
      expect(screen.getByLabelText("Choice")).toBeInTheDocument();
    });

    it("should render with helper text", () => {
      render(
        <Select
          label="Choice"
          options={options}
          value=""
          helperText="Pick one"
        />
      );
      expect(screen.getByText("Pick one")).toBeInTheDocument();
    });

    it("should render in error state", () => {
      render(
        <Select
          label="Choice"
          options={options}
          value=""
          error
          helperText="Required"
        />
      );
      expect(screen.getByText("Required")).toBeInTheDocument();
    });

    it("should render as disabled", () => {
      const { container } = render(
        <Select label="Choice" options={options} value="a" disabled />
      );
      expect(
        container.querySelector(".Mui-disabled")
      ).toBeInTheDocument();
    });

    it("should display the selected value", () => {
      render(<Select label="Choice" options={options} value="b" />);
      expect(screen.getByText("Option B")).toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it("should open dropdown and show options when clicked", async () => {
      render(<Select label="Choice" options={options} value="" />);
      const selectButton = screen.getByRole("combobox");
      await userEvent.click(selectButton);
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
      expect(screen.getByText("Option C")).toBeInTheDocument();
    });

    it("should call onChange when an option is selected", async () => {
      const handleChange = jest.fn();
      render(
        <Select
          label="Choice"
          options={options}
          value=""
          onChange={handleChange}
        />
      );
      const selectButton = screen.getByRole("combobox");
      await userEvent.click(selectButton);
      await userEvent.click(screen.getByText("Option B"));
      expect(handleChange).toHaveBeenCalled();
    });

    it("should render placeholder as disabled option", async () => {
      render(
        <Select
          label="Choice"
          options={options}
          value=""
          placeholder="Select..."
        />
      );
      const selectButton = screen.getByRole("combobox");
      await userEvent.click(selectButton);
      const placeholder = screen.getByText("Select...");
      expect(placeholder.closest("li")).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying div element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Select ref={ref} label="Choice" options={options} value="" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});
