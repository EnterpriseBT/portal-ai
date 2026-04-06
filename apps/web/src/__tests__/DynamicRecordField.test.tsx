import React from "react";
import { jest } from "@jest/globals";

import type { ResolvedColumn } from "@portalai/core/contracts";

// Mock react-markdown and remark-gfm so jsdom doesn't choke on ESM
jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));
jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

const { render, screen, fireEvent } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { DynamicRecordField } = await import(
  "../components/DynamicRecordField.component"
);

// ── Helpers ──────────────────────────────────────────────────────────

function col(
  key: string,
  type: ResolvedColumn["type"],
  overrides?: Partial<ResolvedColumn>
): ResolvedColumn {
  return {
    key,
    normalizedKey: key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    type,
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
    ...overrides,
  };
}

const noop = jest.fn<(key: string, value: unknown) => void>();

beforeEach(() => {
  noop.mockClear();
});

// ── Rendering by type ────────────────────────────────────────────────

describe("DynamicRecordField — rendering by type", () => {
  it("renders text input for string type", () => {
    render(<DynamicRecordField column={col("name", "string")} value="" onChange={noop} />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("type", "text");
  });

  it("renders type=number input for number type", () => {
    render(<DynamicRecordField column={col("age", "number")} value="" onChange={noop} />);
    expect(screen.getByLabelText("Age")).toHaveAttribute("type", "number");
  });

  it("renders checkbox for boolean type", () => {
    render(<DynamicRecordField column={col("active", "boolean")} value={false} onChange={noop} />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("renders type=date input for date type", () => {
    render(<DynamicRecordField column={col("dob", "date")} value="" onChange={noop} />);
    expect(screen.getByLabelText("Dob")).toHaveAttribute("type", "date");
  });

  it("renders type=datetime-local input for datetime type", () => {
    render(<DynamicRecordField column={col("ts", "datetime")} value="" onChange={noop} />);
    expect(screen.getByLabelText("Ts")).toHaveAttribute("type", "datetime-local");
  });

  it("renders select with options for enum type", () => {
    render(
      <DynamicRecordField
        column={col("status", "enum", { enumValues: ["active", "inactive"] })}
        value="active"
        onChange={noop}
      />
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders plain text field for enum when enumValues is null", () => {
    render(<DynamicRecordField column={col("status", "enum")} value="" onChange={noop} />);
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders multiline monospace field for json type", () => {
    render(<DynamicRecordField column={col("meta", "json")} value="" onChange={noop} />);
    const textarea = screen.getByLabelText("Meta");
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("renders multiline monospace field for array type", () => {
    render(<DynamicRecordField column={col("tags", "array")} value="" onChange={noop} />);
    const textarea = screen.getByLabelText("Tags");
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("renders text input for reference type", () => {
    render(<DynamicRecordField column={col("ref", "reference")} value="" onChange={noop} />);
    expect(screen.getByLabelText("Ref")).toBeInTheDocument();
    expect(screen.getByLabelText("Ref")).toHaveAttribute("type", "text");
  });

  it("renders multiline field for reference-array type", () => {
    render(<DynamicRecordField column={col("refs", "reference-array")} value="" onChange={noop} />);
    const textarea = screen.getByLabelText("Refs");
    expect(textarea.tagName).toBe("TEXTAREA");
  });
});

// ── JSON/Array code-editor behavior ──────────────────────────────────

describe("DynamicRecordField — JSON/Array code-editor", () => {
  it("shows placeholder {} for empty json field", () => {
    render(<DynamicRecordField column={col("meta", "json")} value="" onChange={noop} />);
    expect(screen.getByPlaceholderText("{}")).toBeInTheDocument();
  });

  it("shows placeholder [] for empty array field", () => {
    render(<DynamicRecordField column={col("tags", "array")} value="" onChange={noop} />);
    expect(screen.getByPlaceholderText("[]")).toBeInTheDocument();
  });

  it("pretty-prints valid JSON on blur", () => {
    render(<DynamicRecordField column={col("meta", "json")} value='{"a":1}' onChange={noop} />);
    fireEvent.blur(screen.getByLabelText("Meta"));
    expect(noop).toHaveBeenCalledWith("meta", '{\n  "a": 1\n}');
  });

  it("shows parse error on blur for invalid JSON", () => {
    render(
      <DynamicRecordField column={col("meta", "json")} value="{bad" onChange={noop} touched={true} />
    );
    fireEvent.blur(screen.getByLabelText("Meta"));
    expect(screen.getByText(/Invalid JSON:/)).toBeInTheDocument();
  });

  it("clears error when corrected and blurred", () => {
    const { rerender } = render(
      <DynamicRecordField column={col("meta", "json")} value="{bad" onChange={noop} touched={true} />
    );
    fireEvent.blur(screen.getByLabelText("Meta"));
    expect(screen.getByText(/Invalid JSON:/)).toBeInTheDocument();

    rerender(
      <DynamicRecordField column={col("meta", "json")} value='{"a":1}' onChange={noop} touched={true} />
    );
    fireEvent.blur(screen.getByLabelText("Meta"));
    expect(screen.queryByText(/Invalid JSON:/)).not.toBeInTheDocument();
  });

  it("validates array type rejects non-array JSON", () => {
    render(
      <DynamicRecordField column={col("tags", "array")} value='{"a":1}' onChange={noop} touched={true} />
    );
    fireEvent.blur(screen.getByLabelText("Tags"));
    expect(screen.getByText("Value must be a JSON array")).toBeInTheDocument();
  });
});

// ── Validation and accessibility ─────────────────────────────────────

describe("DynamicRecordField — validation and accessibility", () => {
  it("shows error when touched and error are set", () => {
    render(
      <DynamicRecordField
        column={col("name", "string")}
        value=""
        onChange={noop}
        error="Name is required"
        touched={true}
      />
    );
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("does not show error when touched is false", () => {
    render(
      <DynamicRecordField
        column={col("name", "string")}
        value=""
        onChange={noop}
        error="Name is required"
        touched={false}
      />
    );
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });

  it("sets aria-invalid=true when touched and error", () => {
    render(
      <DynamicRecordField
        column={col("name", "string")}
        value=""
        onChange={noop}
        error="Name is required"
        touched={true}
      />
    );
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("sets required attribute when column.required is true", () => {
    render(
      <DynamicRecordField
        column={col("name", "string", { required: true })}
        value=""
        onChange={noop}
      />
    );
    expect(screen.getByLabelText(/Name/)).toBeRequired();
  });

  it("boolean field does not show required", () => {
    render(
      <DynamicRecordField
        column={col("active", "boolean", { required: true })}
        value={false}
        onChange={noop}
      />
    );
    expect(screen.getByRole("checkbox")).not.toBeRequired();
  });
});

// ── Interaction ──────────────────────────────────────────────────────

describe("DynamicRecordField — interaction", () => {
  it("calls onChange with string value for text fields", async () => {
    render(<DynamicRecordField column={col("name", "string")} value="" onChange={noop} />);
    await userEvent.type(screen.getByLabelText("Name"), "hello");
    expect(noop).toHaveBeenCalledWith("name", "h");
  });

  it("calls onChange with string value for number fields", async () => {
    render(<DynamicRecordField column={col("age", "number")} value="" onChange={noop} />);
    await userEvent.type(screen.getByLabelText("Age"), "2");
    expect(noop).toHaveBeenCalledWith("age", "2");
  });

  it("calls onChange with boolean value for checkbox", async () => {
    render(<DynamicRecordField column={col("active", "boolean")} value={false} onChange={noop} />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(noop).toHaveBeenCalledWith("active", true);
  });

  it("calls onChange with string value for enum select", async () => {
    render(
      <DynamicRecordField
        column={col("status", "enum", { enumValues: ["active", "inactive"] })}
        value=""
        onChange={noop}
      />
    );
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("active"));
    expect(noop).toHaveBeenCalledWith("status", "active");
  });

  it("disables input when disabled is true", () => {
    render(
      <DynamicRecordField column={col("name", "string")} value="" onChange={noop} disabled={true} />
    );
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });

  it("passes inputRef to the underlying input", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(
      <DynamicRecordField column={col("name", "string")} value="" onChange={noop} inputRef={ref} />
    );
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
