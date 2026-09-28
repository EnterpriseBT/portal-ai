import { jest } from "@jest/globals";

// The container imports the SDK; stub it so the import graph stays light. The
// pure UI (CuratedViewEditorUI) is props-driven and does no fetching.
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    curatedViews: { create: jest.fn(), update: jest.fn() },
    fieldMappings: { list: jest.fn() },
    entityRecords: { list: jest.fn() },
    connectorEntities: { list: jest.fn() },
  },
  queryKeys: { curatedViews: { root: ["curatedViews"] } },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { CuratedViewEditorUI, CuratedViewEditorDialog } =
  await import("../components/CuratedViewEditorDialog.component");

const baseProps = {
  mode: "create" as const,
  onClose: jest.fn(),
  showEntitySelect: false,
  entityOptions: [],
  selectedEntityId: "ent-1",
  onEntityChange: jest.fn(),
  fieldMappingOptions: [],
  columnDefinitions: [],
  label: "NE Accounts",
  onLabelChange: jest.fn(),
  keyValue: "ne_accounts",
  onKeyChange: jest.fn(),
  description: "",
  onDescriptionChange: jest.fn(),
  selectedFieldMappingIds: [],
  onSelectedFieldMappingIdsChange: jest.fn(),
  filter: { combinator: "and" as const, conditions: [] },
  onFilterChange: jest.fn(),
  errors: {},
  touched: {},
  onLabelBlur: jest.fn(),
  onKeyBlur: jest.fn(),
  onSubmit: jest.fn(),
  columnsReady: true,
};

describe("CuratedViewEditorUI (pure form)", () => {
  it("renders the create title + a required label field", () => {
    render(<CuratedViewEditorUI {...baseProps} />);
    expect(screen.getByText("Create View")).toBeInTheDocument();
    const label = screen.getByRole("textbox", { name: /label/i });
    expect(label).toBeRequired();
  });

  it("calls onSubmit on Save and onClose on Cancel", async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    render(
      <CuratedViewEditorUI
        {...baseProps}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state when pending", () => {
    render(<CuratedViewEditorUI {...baseProps} isPending />);
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("shows a field-level error + aria-invalid when touched", () => {
    render(
      <CuratedViewEditorUI
        {...baseProps}
        errors={{ label: "Label is required" }}
        touched={{ label: true }}
      />
    );
    expect(screen.getByText("Label is required")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /label/i })).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("renders FormAlert only when serverError is present", () => {
    const { rerender } = render(<CuratedViewEditorUI {...baseProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(
      <CuratedViewEditorUI
        {...baseProps}
        serverError={{ message: "Boom", code: "X" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
  });
});

describe("CuratedViewEditorDialog (container gating)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CuratedViewEditorDialog
        open={false}
        mode="create"
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
