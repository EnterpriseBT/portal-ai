import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { jest } from "@jest/globals";

import { ColorPicker } from "../../ui/ColorPicker.js";
import { expectNoAxeViolations } from "../axe.util";

// Mock canvas context
function mockCanvasContext() {
  const imageData = { data: new Uint8ClampedArray(4 * 200 * 200) };
  const ctx = {
    clearRect: jest.fn(),
    createImageData: jest.fn().mockReturnValue(imageData),
    putImageData: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    strokeStyle: "",
    lineWidth: 0,
  };
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return ctx;
}

function openPopup() {
  fireEvent.click(screen.getByLabelText("Toggle color picker"));
}

describe("ColorPicker", () => {
  beforeEach(() => {
    mockCanvasContext();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Rendering", () => {
    it("should render the hex input field", () => {
      render(<ColorPicker value="#ff0000" />);
      const input = screen.getByLabelText("Hex color value");
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue("#ff0000");
    });

    it("should render the color dropper icon button", () => {
      render(<ColorPicker />);
      expect(screen.getByLabelText("Toggle color picker")).toBeInTheDocument();
    });

    it("should render a label when provided", () => {
      render(<ColorPicker label="Pick a color" />);
      expect(screen.getByText("Pick a color")).toBeInTheDocument();
    });

    it("should not render a label when not provided", () => {
      render(<ColorPicker />);
      expect(screen.queryByText("Pick a color")).not.toBeInTheDocument();
    });

    it("should render the color preview box", () => {
      render(<ColorPicker value="#00ff00" />);
      expect(screen.getByTestId("color-preview")).toBeInTheDocument();
    });

    it("should not show the popup by default", () => {
      render(<ColorPicker />);
      expect(screen.queryByTestId("color-wheel")).not.toBeInTheDocument();
    });
  });

  describe("Popup Toggle", () => {
    it("should open the popup when the dropper icon is clicked", () => {
      render(<ColorPicker />);
      openPopup();
      expect(screen.getByTestId("color-wheel")).toBeInTheDocument();
      expect(screen.getByLabelText("Lightness")).toBeInTheDocument();
    });

    it("should close the popup when the dropper icon is clicked again", () => {
      render(<ColorPicker />);
      openPopup();
      expect(screen.getByTestId("color-wheel")).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText("Toggle color picker"));
      expect(screen.queryByTestId("color-wheel")).not.toBeInTheDocument();
    });

    it("should not open popup when disabled", () => {
      render(<ColorPicker disabled />);
      fireEvent.click(screen.getByLabelText("Toggle color picker"));
      expect(screen.queryByTestId("color-wheel")).not.toBeInTheDocument();
    });
  });

  describe("Hex Input", () => {
    it("should call onChange with valid hex input", () => {
      const handleChange = jest.fn();
      render(<ColorPicker value="#000000" onChange={handleChange} />);
      const input = screen.getByLabelText("Hex color value");

      fireEvent.change(input, { target: { value: "#abcdef" } });
      expect(handleChange).toHaveBeenCalledWith("#abcdef");
    });

    // #793: the form sees what the field shows, so its validation can block
    // a save; a draft that never reached it was saved as the last good color.
    it("should report an invalid draft to onChange, so the form can reject it", () => {
      const handleChange = jest.fn();
      render(<ColorPicker value="#000000" onChange={handleChange} />);
      const input = screen.getByLabelText("Hex color value");

      fireEvent.change(input, { target: { value: "#gggggg" } });
      expect(handleChange).toHaveBeenCalledWith("#gggggg");
    });

    it("keeps its draft and lightness when the form echoes an invalid value back", () => {
      const { rerender } = render(<ColorPicker value="#ff0000" />);
      rerender(<ColorPicker value="#ggg" />);
      expect(screen.getByLabelText("Hex color value")).toHaveValue("#ggg");
      rerender(<ColorPicker value="#00ff00" />);
      expect(screen.getByLabelText("Hex color value")).toHaveValue("#00ff00");
    });

    it("explains an invalid draft in the field's description", () => {
      render(<ColorPicker value="#000000" />);
      const input = screen.getByLabelText("Hex color value");
      expect(input).not.toHaveAccessibleDescription();

      fireEvent.change(input, { target: { value: "#zz" } });
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(
        "Enter a 6-digit hex color, like #FF0000"
      );
    });

    it("lets a form's helperText replace its own explanation", () => {
      render(
        <ColorPicker
          value="#zz"
          error
          helperText="Color must be a valid hex code"
        />
      );
      expect(
        screen.getByLabelText("Hex color value")
      ).toHaveAccessibleDescription("Color must be a valid hex code");
    });

    it("should prepend # if missing from input", () => {
      const handleChange = jest.fn();
      render(<ColorPicker value="#000000" onChange={handleChange} />);
      const input = screen.getByLabelText("Hex color value");

      fireEvent.change(input, { target: { value: "abcdef" } });
      expect(handleChange).toHaveBeenCalledWith("#abcdef");
    });

    it("should update input value when value prop changes", () => {
      const { rerender } = render(<ColorPicker value="#ff0000" />);
      const input = screen.getByLabelText("Hex color value");
      expect(input).toHaveValue("#ff0000");

      rerender(<ColorPicker value="#00ff00" />);
      expect(input).toHaveValue("#00ff00");
    });
  });

  describe("Color Samples", () => {
    const samples: Array<{ color: string; label?: string }> = [
      { color: "#ff0000", label: "Red" },
      { color: "#00ff00", label: "Green" },
      { color: "#0000ff", label: "Blue" },
    ];

    it("should render color samples below the textbox", () => {
      render(<ColorPicker samples={samples} />);
      expect(screen.getByText("Samples")).toBeInTheDocument();
      expect(screen.getByLabelText("Select color Red")).toBeInTheDocument();
      expect(screen.getByLabelText("Select color Green")).toBeInTheDocument();
      expect(screen.getByLabelText("Select color Blue")).toBeInTheDocument();
    });

    it("should not render samples section when not provided", () => {
      render(<ColorPicker />);
      expect(screen.queryByText("Samples")).not.toBeInTheDocument();
    });

    it("should not render samples section for empty array", () => {
      render(<ColorPicker samples={[]} />);
      expect(screen.queryByText("Samples")).not.toBeInTheDocument();
    });

    it("should call onChange when a sample is clicked", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker
          value="#000000"
          onChange={handleChange}
          samples={samples}
        />
      );

      fireEvent.click(screen.getByLabelText("Select color Red"));
      expect(handleChange).toHaveBeenCalledWith("#ff0000");
    });

    it("should call onChange on Enter key press on sample", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker
          value="#000000"
          onChange={handleChange}
          samples={samples}
        />
      );

      fireEvent.keyDown(screen.getByLabelText("Select color Green"), {
        key: "Enter",
      });
      expect(handleChange).toHaveBeenCalledWith("#00ff00");
    });

    it("should call onChange on Space key press on sample", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker
          value="#000000"
          onChange={handleChange}
          samples={samples}
        />
      );

      fireEvent.keyDown(screen.getByLabelText("Select color Blue"), {
        key: " ",
      });
      expect(handleChange).toHaveBeenCalledWith("#0000ff");
    });

    it("should use color as label when label is not provided", () => {
      const noLabelSamples: Array<{ color: string; label?: string }> = [
        { color: "#abcdef" },
      ];
      render(<ColorPicker samples={noLabelSamples} />);
      expect(screen.getByLabelText("Select color #abcdef")).toBeInTheDocument();
    });

    it("should highlight the selected sample", () => {
      render(<ColorPicker value="#ff0000" samples={samples} />);
      const selected = screen.getByLabelText("Select color Red");
      expect(selected).toBeInTheDocument();
    });
  });

  describe("Color Wheel Interaction", () => {
    it("should pick a color on mouse down within the wheel", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker value="#000000" onChange={handleChange} wheelSize={200} />
      );
      openPopup();

      const canvas = screen.getByTestId("color-wheel");
      const rect = { left: 0, top: 0 };
      jest
        .spyOn(canvas, "getBoundingClientRect")
        .mockReturnValue(rect as DOMRect);

      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      expect(handleChange).toHaveBeenCalled();
    });

    it("should not pick color outside the wheel radius", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker value="#000000" onChange={handleChange} wheelSize={200} />
      );
      openPopup();

      const canvas = screen.getByTestId("color-wheel");
      const rect = { left: 0, top: 0 };
      jest
        .spyOn(canvas, "getBoundingClientRect")
        .mockReturnValue(rect as DOMRect);

      fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0 });
      expect(handleChange).not.toHaveBeenCalled();
    });

    it("should pick colors while dragging", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker value="#000000" onChange={handleChange} wheelSize={200} />
      );
      openPopup();

      const canvas = screen.getByTestId("color-wheel");
      const rect = { left: 0, top: 0 };
      jest
        .spyOn(canvas, "getBoundingClientRect")
        .mockReturnValue(rect as DOMRect);

      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(canvas, { clientX: 120, clientY: 100 });
      expect(handleChange).toHaveBeenCalledTimes(2);
    });

    it("should stop picking on mouse up", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker value="#000000" onChange={handleChange} wheelSize={200} />
      );
      openPopup();

      const canvas = screen.getByTestId("color-wheel");
      const rect = { left: 0, top: 0 };
      jest
        .spyOn(canvas, "getBoundingClientRect")
        .mockReturnValue(rect as DOMRect);

      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      fireEvent.mouseUp(canvas);
      fireEvent.mouseMove(canvas, { clientX: 120, clientY: 100 });
      expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it("should stop picking on mouse leave", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker value="#000000" onChange={handleChange} wheelSize={200} />
      );
      openPopup();

      const canvas = screen.getByTestId("color-wheel");
      const rect = { left: 0, top: 0 };
      jest
        .spyOn(canvas, "getBoundingClientRect")
        .mockReturnValue(rect as DOMRect);

      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      fireEvent.mouseLeave(canvas);
      fireEvent.mouseMove(canvas, { clientX: 120, clientY: 100 });
      expect(handleChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("Lightness Slider", () => {
    it("should change lightness and update the color", () => {
      const handleChange = jest.fn();
      render(<ColorPicker value="#ff0000" onChange={handleChange} />);
      openPopup();
      const slider = screen.getByLabelText("Lightness");

      fireEvent.change(slider, { target: { value: "0.7" } });
      expect(handleChange).toHaveBeenCalled();
      const newColor = handleChange.mock.calls[0][0];
      expect(newColor).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe("Disabled State", () => {
    it("should disable the hex input when disabled", () => {
      render(<ColorPicker disabled />);
      const input = screen.getByLabelText("Hex color value");
      expect(input).toBeDisabled();
    });

    it("should disable the dropper button when disabled", () => {
      render(<ColorPicker disabled />);
      expect(screen.getByLabelText("Toggle color picker")).toBeDisabled();
    });

    it("should not call onChange on sample click when disabled", () => {
      const handleChange = jest.fn();
      const samples = [{ color: "#ff0000", label: "Red" }];
      render(
        <ColorPicker disabled onChange={handleChange} samples={samples} />
      );

      fireEvent.click(screen.getByLabelText("Select color Red"));
      expect(handleChange).not.toHaveBeenCalled();
    });

    it("should not pick color from wheel when disabled", () => {
      const handleChange = jest.fn();
      render(
        <ColorPicker
          disabled
          value="#000000"
          onChange={handleChange}
          wheelSize={200}
        />
      );

      // Popup can't be opened when disabled
      fireEvent.click(screen.getByLabelText("Toggle color picker"));
      expect(screen.queryByTestId("color-wheel")).not.toBeInTheDocument();
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe("Default Values", () => {
    it("should default to #000000 when no value provided", () => {
      render(<ColorPicker />);
      const input = screen.getByLabelText("Hex color value");
      expect(input).toHaveValue("#000000");
    });

    it("should default wheel size to 200", () => {
      render(<ColorPicker />);
      openPopup();
      const canvas = screen.getByTestId("color-wheel");
      expect(canvas).toHaveAttribute("width", "200");
      expect(canvas).toHaveAttribute("height", "200");
    });

    it("should respect custom wheel size", () => {
      render(<ColorPicker wheelSize={150} />);
      openPopup();
      const canvas = screen.getByTestId("color-wheel");
      expect(canvas).toHaveAttribute("width", "150");
      expect(canvas).toHaveAttribute("height", "150");
    });
  });
});

// #793: the picker is a labelled group, and a form's required/error state
// reaches its field.
describe("ColorPicker accessibility (#793)", () => {
  beforeEach(() => {
    mockCanvasContext();
  });

  it("is a group named by its label", () => {
    render(<ColorPicker label="Color" value="#ff0000" />);
    expect(screen.getByRole("group", { name: "Color" })).toBeInTheDocument();
  });

  it("passes required, error and helper text to its hex field", () => {
    render(
      <ColorPicker
        label="Color"
        value=""
        required
        error
        helperText="Pick a color"
      />
    );
    const field = screen.getByRole("textbox", { name: /Hex color value/ });
    expect(field).toBeRequired();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Pick a color");
  });

  it("is not invalid by default", () => {
    render(<ColorPicker label="Color" value="#ff0000" />);
    expect(
      screen.getByRole("textbox", { name: /Hex color value/ })
    ).toHaveAttribute("aria-invalid", "false");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ColorPicker label="Color" value="#ff0000" error helperText="Bad" />
    );
    await expectNoAxeViolations(container);
  });
});
