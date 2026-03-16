import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { TextInput } from "../../ui/TextInput";

describe("TextInput Component", () => {
  describe("Rendering", () => {
    it("should render with label", () => {
      render(<TextInput label="Username" />);
      expect(screen.getByLabelText("Username")).toBeInTheDocument();
    });

    it("should render with placeholder", () => {
      render(<TextInput placeholder="Enter text" />);
      expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
    });

    it("should render with helper text", () => {
      render(<TextInput helperText="Required field" />);
      expect(screen.getByText("Required field")).toBeInTheDocument();
    });

    it("should render in error state", () => {
      render(<TextInput label="Email" error helperText="Invalid email" />);
      expect(screen.getByText("Invalid email")).toBeInTheDocument();
    });

    it("should render as disabled", () => {
      render(<TextInput label="Disabled" disabled />);
      expect(screen.getByLabelText("Disabled")).toBeDisabled();
    });

    it("should render multiline", () => {
      render(<TextInput label="Bio" multiline rows={4} />);
      expect(screen.getByLabelText("Bio")).toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it("should accept user input", async () => {
      render(<TextInput label="Name" />);
      const input = screen.getByLabelText("Name");
      await userEvent.type(input, "John");
      expect(input).toHaveValue("John");
    });

    it("should call onChange handler", async () => {
      const handleChange = jest.fn();
      render(<TextInput label="Name" onChange={handleChange} />);
      await userEvent.type(screen.getByLabelText("Name"), "a");
      expect(handleChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying div element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<TextInput ref={ref} label="Ref test" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Custom Props", () => {
    it("should accept custom data attributes", () => {
      render(<TextInput data-testid="custom-input" label="Test" />);
      expect(screen.getByTestId("custom-input")).toBeInTheDocument();
    });

    it("should default to outlined variant and small size", () => {
      const { container } = render(<TextInput label="Default" />);
      expect(
        container.querySelector(".MuiOutlinedInput-root")
      ).toBeInTheDocument();
      expect(
        container.querySelector(".MuiInputBase-sizeSmall")
      ).toBeInTheDocument();
    });
  });
});
