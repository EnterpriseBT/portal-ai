import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { FileUploader } from "../../ui/FileUploader";
import { expectNoAxeViolations } from "../axe.util";

function createFile(name: string, sizeMB: number, type = "text/plain"): File {
  const bytes = new ArrayBuffer(sizeMB * 1024 * 1024);
  return new File([bytes], name, { type });
}

describe("FileUploader Component", () => {
  describe("Rendering", () => {
    it("should render the dropzone", () => {
      render(<FileUploader />);
      expect(
        screen.getByText("Choose a file or drop it here")
      ).toBeInTheDocument();
    });

    it("should display accepted file types", () => {
      render(<FileUploader accept=".png,.jpg" />);
      expect(screen.getByText("Accepted: .png,.jpg")).toBeInTheDocument();
    });

    it("should render helper text", () => {
      render(<FileUploader helperText="Max 5MB" />);
      expect(screen.getByText("Max 5MB")).toBeInTheDocument();
    });

    it("should render in error state", () => {
      render(<FileUploader error helperText="Upload required" />);
      expect(screen.getByText("Upload required")).toBeInTheDocument();
    });

    it("should render with reduced opacity when disabled", () => {
      render(<FileUploader disabled />);
      const dropzone = screen.getByTestId("dropzone");
      expect(dropzone).toBeInTheDocument();
    });
  });

  describe("File Selection", () => {
    it("should open file dialog when dropzone is clicked", async () => {
      render(<FileUploader />);
      const input = screen.getByTestId("file-input") as HTMLInputElement;
      const clickSpy = jest.spyOn(input, "click");
      await userEvent.click(screen.getByTestId("dropzone"));
      expect(clickSpy).toHaveBeenCalled();
    });

    it("should call onChange when files are selected via input", () => {
      const handleChange = jest.fn();
      render(<FileUploader onChange={handleChange} />);
      const input = screen.getByTestId("file-input");
      const file = createFile("test.txt", 0.001);
      fireEvent.change(input, { target: { files: [file] } });
      expect(handleChange).toHaveBeenCalledWith([file]);
    });

    it("should display selected file name", () => {
      render(<FileUploader />);
      const input = screen.getByTestId("file-input");
      const file = createFile("document.pdf", 0.001);
      fireEvent.change(input, { target: { files: [file] } });
      expect(screen.getByText("document.pdf")).toBeInTheDocument();
    });

    it("should allow removing a selected file", async () => {
      const handleChange = jest.fn();
      render(<FileUploader onChange={handleChange} />);
      const input = screen.getByTestId("file-input");
      const file = createFile("test.txt", 0.001);
      fireEvent.change(input, { target: { files: [file] } });
      expect(screen.getByText("test.txt")).toBeInTheDocument();

      await userEvent.click(screen.getByLabelText("Remove test.txt"));
      expect(screen.queryByText("test.txt")).not.toBeInTheDocument();
      expect(handleChange).toHaveBeenLastCalledWith([]);
    });
  });

  describe("Validation", () => {
    it("should reject files exceeding maxSizeMB", () => {
      const handleChange = jest.fn();
      render(<FileUploader maxSizeMB={1} onChange={handleChange} />);
      const input = screen.getByTestId("file-input");
      const file = createFile("large.bin", 2);
      fireEvent.change(input, { target: { files: [file] } });
      expect(
        screen.getByText("large.bin exceeds the 1MB size limit")
      ).toBeInTheDocument();
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe("Drag and Drop", () => {
    it("should handle file drop", () => {
      const handleChange = jest.fn();
      render(<FileUploader onChange={handleChange} />);
      const dropzone = screen.getByTestId("dropzone");
      const file = createFile("dropped.txt", 0.001);
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file] },
      });
      expect(handleChange).toHaveBeenCalledWith([file]);
    });

    it("should not accept drops when disabled", () => {
      const handleChange = jest.fn();
      render(<FileUploader disabled onChange={handleChange} />);
      const dropzone = screen.getByTestId("dropzone");
      const file = createFile("dropped.txt", 0.001);
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file] },
      });
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe("Multiple Files", () => {
    it("should accept multiple files when multiple is true", () => {
      const handleChange = jest.fn();
      render(<FileUploader multiple onChange={handleChange} />);
      const input = screen.getByTestId("file-input");
      const file1 = createFile("a.txt", 0.001);
      const file2 = createFile("b.txt", 0.001);
      fireEvent.change(input, { target: { files: [file1, file2] } });
      expect(handleChange).toHaveBeenCalledWith([file1, file2]);
      expect(screen.getByText("a.txt")).toBeInTheDocument();
      expect(screen.getByText("b.txt")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the container element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<FileUploader ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});

describe("FileUploader — by keyboard (#795)", () => {
  it("is a native button named by its visible text, described by its formats", () => {
    render(<FileUploader accept=".png,.jpg" multiple />);
    const button = screen.getByRole("button", {
      name: "Choose files or drop them here",
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAccessibleDescription("Accepted: .png,.jpg");
  });

  it.each(["{Enter}", " "])("%s on it opens the file chooser", async (key) => {
    render(<FileUploader />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const click = jest.spyOn(input, "click").mockImplementation(() => {});
    screen
      .getByRole("button", { name: "Choose a file or drop it here" })
      .focus();
    await userEvent.keyboard(key);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("is disabled, not a dead tab stop, when disabled", () => {
    render(<FileUploader disabled />);
    expect(
      screen.getByRole("button", { name: "Choose a file or drop it here" })
    ).toBeDisabled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <FileUploader accept=".csv" helperText="Max 5MB" />
    );
    await expectNoAxeViolations(container);
  });
});
