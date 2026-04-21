import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SelectOption } from "@portalai/core/ui";

import { BindingEditorPopoverUI } from "../BindingEditorPopover.component";
import type { BindingEditorPopoverUIProps } from "../BindingEditorPopover.component";
import type { ColumnBindingDraft } from "../utils/region-editor.types";

const baseBinding: ColumnBindingDraft = {
  sourceLocator: "header:Email",
  columnDefinitionId: "coldef_email",
  columnDefinitionLabel: "Email",
  confidence: 0.9,
};

function makeSearchStub(): NonNullable<
  BindingEditorPopoverUIProps["columnDefinitionSearch"]
> {
  return {
    onSearch: jest.fn(async () => [] as SelectOption[]),
    onSearchPending: false,
    onSearchError: null,
    getById: jest.fn(async () => null),
    getByIdPending: false,
    getByIdError: null,
    labelMap: {},
  };
}

function setup(overrides: Partial<BindingEditorPopoverUIProps> = {}) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onChange = jest.fn<(patch: Partial<ColumnBindingDraft>) => void>();
  const onApply = jest.fn();
  const onCancel = jest.fn();
  const utils = render(
    <BindingEditorPopoverUI
      open
      anchorEl={anchor}
      binding={baseBinding}
      draft={baseBinding}
      errors={{}}
      serverError={null}
      columnDefinitionSearch={makeSearchStub()}
      onChange={onChange}
      onApply={onApply}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { ...utils, onChange, onApply, onCancel, anchor };
}

describe("BindingEditorPopoverUI — rendering", () => {
  test("renders the source locator header for byHeaderName", () => {
    setup({ draft: { ...baseBinding, sourceLocator: "header:Email" } });
    // Primary header text renders as an h6.
    expect(
      screen.getByRole("heading", { level: 6, name: /^email$/i })
    ).toBeInTheDocument();
    // "Header" chip marks this as a header-derived locator.
    expect(screen.getByText(/^header$/i)).toBeInTheDocument();
  });

  test("renders the source locator header for byColumnIndex", () => {
    setup({ draft: { ...baseBinding, sourceLocator: "col:3" } });
    expect(screen.getByText(/column 3/i)).toBeInTheDocument();
  });

  test("shows the resolved type chip + description when supplied", () => {
    setup({
      columnDefinitionType: "string",
      columnDefinitionDescription: "Email address",
    });
    expect(screen.getByText(/string/i)).toBeInTheDocument();
    expect(screen.getByText(/email address/i)).toBeInTheDocument();
  });

  test("hides the reference editor when type is not reference / reference-array", () => {
    setup({ columnDefinitionType: "string" });
    expect(screen.queryByLabelText(/ref entity/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ref field/i)).not.toBeInTheDocument();
  });

  test("shows the reference editor when type is reference", () => {
    setup({
      columnDefinitionType: "reference",
      referenceEntityOptions: [
        { value: "staged_customers", label: "Customers (this import)" },
      ],
    });
    expect(screen.getByLabelText(/ref entity/i)).toBeInTheDocument();
  });

  test("hides the enumValues input when type is not 'enum'", () => {
    setup({ columnDefinitionType: "string" });
    expect(screen.queryByLabelText(/enum values/i)).not.toBeInTheDocument();
  });

  test("shows the enumValues input when type is 'enum'", () => {
    setup({ columnDefinitionType: "enum" });
    expect(screen.getByLabelText(/enum values/i)).toBeInTheDocument();
  });

  test("when excluded is true: disables per-type editors and surfaces an alert", () => {
    setup({ draft: { ...baseBinding, excluded: true } });
    expect(screen.getByRole("alert")).toHaveTextContent(/excluded/i);
    // The normalizedKey field is disabled when excluded — user must un-omit
    // first to edit mappings.
    const nk = screen.getByLabelText(/normalized key/i) as HTMLInputElement;
    expect(nk).toBeDisabled();
  });

  test("does not render when open is false", () => {
    render(
      <BindingEditorPopoverUI
        open={false}
        anchorEl={document.createElement("button")}
        binding={baseBinding}
        draft={baseBinding}
        errors={{}}
        serverError={null}
        columnDefinitionSearch={makeSearchStub()}
        onChange={jest.fn()}
        onApply={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.queryByLabelText(/normalized key/i)).not.toBeInTheDocument();
  });
});

describe("BindingEditorPopoverUI — interaction", () => {
  test("editing normalizedKey fires onChange with the new value", () => {
    const { onChange } = setup();
    const nk = screen.getByLabelText(/normalized key/i) as HTMLInputElement;
    fireEvent.change(nk, { target: { value: "email_override" } });
    expect(onChange).toHaveBeenCalledWith({ normalizedKey: "email_override" });
  });

  test("toggling Omit fires onChange with excluded: true", () => {
    const { onChange } = setup();
    const omit = screen.getByLabelText(/omit this column/i);
    fireEvent.click(omit);
    expect(onChange).toHaveBeenCalledWith({ excluded: true });
  });

  test("Apply fires onApply", () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onApply).toHaveBeenCalled();
  });

  test("Cancel fires onCancel", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("submitting the form fires onApply", () => {
    const { onApply } = setup();
    // MUI Popover portals into document.body — query globally rather than by container.
    const form = document.querySelector<HTMLFormElement>(
      'form[aria-label="Edit column binding"]'
    );
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(onApply).toHaveBeenCalled();
  });

  test("toggling Required fires onChange with required: true", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText(/^required$/i));
    expect(onChange).toHaveBeenCalledWith({ required: true });
  });
});

describe("BindingEditorPopoverUI — validation", () => {
  test("renders a per-field error when errors.normalizedKey is set", () => {
    setup({
      draft: { ...baseBinding, normalizedKey: "Bad Key" },
      errors: { normalizedKey: "Invalid normalizedKey" },
    });
    expect(screen.getByText(/invalid normalizedkey/i)).toBeInTheDocument();
    const nk = screen.getByLabelText(/normalized key/i) as HTMLInputElement;
    expect(nk).toHaveAttribute("aria-invalid", "true");
  });

  test("shows the FormAlert when a serverError is provided", () => {
    setup({
      serverError: { message: "Reference unresolvable", code: "X_Y_Z" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/reference unresolvable/i);
  });

  test("Apply is disabled while errors are present", () => {
    setup({ errors: { normalizedKey: "oops" } });
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
  });
});
