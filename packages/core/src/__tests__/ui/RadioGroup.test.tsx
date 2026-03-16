import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { RadioGroup } from "../../ui/RadioGroup";

const options = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
  { value: "c", label: "Option C" },
];

describe("RadioGroup Component", () => {
  describe("Rendering", () => {
    it("should render all options", () => {
      render(<RadioGroup options={options} />);
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
      expect(screen.getByText("Option C")).toBeInTheDocument();
    });

    it("should render with label", () => {
      render(<RadioGroup label="Pick one" options={options} />);
      expect(screen.getByText("Pick one")).toBeInTheDocument();
    });

    it("should render with helper text", () => {
      render(
        <RadioGroup options={options} helperText="Choose wisely" />
      );
      expect(screen.getByText("Choose wisely")).toBeInTheDocument();
    });

    it("should render the correct radio as checked", () => {
      render(<RadioGroup options={options} value="b" />);
      const radios = screen.getAllByRole("radio");
      expect(radios[0]).not.toBeChecked();
      expect(radios[1]).toBeChecked();
      expect(radios[2]).not.toBeChecked();
    });

    it("should render disabled option", () => {
      const opts = [...options, { value: "d", label: "Disabled", disabled: true }];
      render(<RadioGroup options={opts} />);
      const radios = screen.getAllByRole("radio");
      expect(radios[3]).toBeDisabled();
    });
  });

  describe("Interaction", () => {
    it("should call onChange when a radio is clicked", async () => {
      const handleChange = jest.fn();
      render(<RadioGroup options={options} onChange={handleChange} />);
      await userEvent.click(screen.getByText("Option B"));
      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe("Error State", () => {
    it("should display error helper text", () => {
      render(
        <RadioGroup
          options={options}
          error
          helperText="Selection required"
        />
      );
      expect(screen.getByText("Selection required")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the form control element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<RadioGroup ref={ref} options={options} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});
