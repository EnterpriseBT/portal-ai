import { jest, beforeEach } from "@jest/globals";

// The container imports the SDK; stub it so the import graph stays light. The
// pure UI (CuratedViewEditorUI) is props-driven and does no fetching.
const mockCreateMutate = jest.fn();
const mockUpdateMutate = jest.fn();
const mockPreviewMutateAsync = jest.fn<(vars: unknown) => Promise<unknown>>();
const mockSuggestMutateAsync = jest.fn<(vars: unknown) => Promise<unknown>>();
const mutation = (extra: Record<string, unknown>) => ({
  isPending: false,
  error: null,
  reset: jest.fn(),
  ...extra,
});
let mockSqlEntitled = true;

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    curatedViews: {
      create: () => mutation({ mutate: mockCreateMutate }),
      update: () => mutation({ mutate: mockUpdateMutate }),
      previewFilterSql: () => mutation({ mutateAsync: mockPreviewMutateAsync }),
      suggestFilterSql: () => mutation({ mutateAsync: mockSuggestMutateAsync }),
    },
    fieldMappings: { list: () => ({ data: { fieldMappings: [] } }) },
    entityRecords: {
      list: () => ({
        data: {
          columns: [
            { key: "age", normalizedKey: "age", label: "Age", type: "number" },
          ],
        },
        isLoading: false,
      }),
    },
    connectorEntities: { list: () => ({ data: { connectorEntities: [] } }) },
  },
  queryKeys: { curatedViews: { root: ["curatedViews"] } },
}));
// #644: the SQL mode's entitlement, without the router the real hook needs.
jest.unstable_mockModule("../utils/use-action-gate.util", () => ({
  useActionGate: () => ({
    entitled: () => mockSqlEntitled,
    gate: (input: { entitled?: boolean; upgradeReason?: string }) =>
      input.entitled === false
        ? { kind: "upsell", reason: input.upgradeReason, onUpgrade: jest.fn() }
        : { kind: "allow" },
  }),
}));

const { render, screen, pressEnter } = await import("./test-utils");
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
  filterMode: "builder" as const,
  onFilterModeChange: jest.fn(),
  sqlModeGate: { kind: "allow" as const },
  filterSqlEditor: {
    value: "",
    onChange: jest.fn(),
    onBlur: jest.fn(),
    touched: false,
    columnKeys: ["age"],
    readOnly: false,
    suggest: {
      prompt: "",
      onPromptChange: jest.fn(),
      onSuggest: jest.fn(),
      pending: false,
      serverError: null,
      warning: null,
    },
    preview: {
      onRun: jest.fn(),
      pending: false,
      serverError: null,
      result: null,
    },
  },
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

  // #789: a real Enter in the label field saves, exactly like Save.
  it("saves on a real Enter in the label field", async () => {
    const onSubmit = jest.fn();
    render(<CuratedViewEditorUI {...baseProps} onSubmit={onSubmit} />);
    await pressEnter(screen.getByRole("textbox", { name: /^label/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("doesn't save on Enter while pending", async () => {
    const onSubmit = jest.fn();
    render(
      <CuratedViewEditorUI {...baseProps} onSubmit={onSubmit} isPending />
    );
    await pressEnter(screen.getByRole("textbox", { name: /^label/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("CuratedViewEditorUI SQL mode (#644)", () => {
  it("switches between the builder and SQL", async () => {
    const onFilterModeChange = jest.fn();
    render(
      <CuratedViewEditorUI
        {...baseProps}
        onFilterModeChange={onFilterModeChange}
      />
    );
    expect(screen.getByRole("button", { name: "Builder" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await userEvent.click(screen.getByRole("button", { name: "SQL" }));
    expect(onFilterModeChange).toHaveBeenCalledWith("sql");
  });

  it("renders the SQL editor, not the builder, in SQL mode", () => {
    render(<CuratedViewEditorUI {...baseProps} filterMode="sql" />);
    expect(screen.getByRole("textbox", { name: /sql filter/i })).toBeRequired();
  });

  it("sends a plan without SQL filters to the upgrade, not into SQL mode", async () => {
    const onUpgrade = jest.fn();
    const onFilterModeChange = jest.fn();
    render(
      <CuratedViewEditorUI
        {...baseProps}
        onFilterModeChange={onFilterModeChange}
        sqlModeGate={{ kind: "upsell", reason: "Upgrade", onUpgrade }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /sql/i }));
    expect(onUpgrade).toHaveBeenCalled();
    expect(onFilterModeChange).not.toHaveBeenCalled();
  });
});

describe("CuratedViewEditorDialog SQL mode (#644)", () => {
  const sqlView = {
    id: "view-1",
    organizationId: "org-1",
    connectorEntityId: "ent-1",
    key: "over_thirty",
    label: "Over thirty",
    description: null,
    filter: null,
    filterSql: "age > 30",
    filterSqlKeys: ["age"],
    fieldMappingIds: [],
  } as never;

  beforeEach(() => {
    mockSqlEntitled = true;
    mockCreateMutate.mockReset();
    mockUpdateMutate.mockReset();
    mockPreviewMutateAsync.mockReset();
    mockSuggestMutateAsync.mockReset();
  });

  const open = (props: Record<string, unknown>) =>
    render(
      <CuratedViewEditorDialog
        open
        onClose={jest.fn()}
        onSaved={jest.fn()}
        mode="edit"
        {...props}
      />
    );

  it("saves a SQL view's filter, and only the SQL mode's", async () => {
    open({ view: sqlView });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ filter: null, filterSql: "age > 30" }),
      expect.anything()
    );
  });

  it("saves the builder's filter and clears SQL after switching modes", async () => {
    open({ view: sqlView });
    await userEvent.click(screen.getByRole("button", { name: "Builder" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ filter: null, filterSql: null }),
      expect.anything()
    );
  });

  it("creates in builder mode without a SQL filter", async () => {
    open({ mode: "create", connectorEntityId: "ent-1" });
    await userEvent.type(
      screen.getByRole("textbox", { name: /^label/i }),
      "Adults"
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: /^key/i }),
      "adults"
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const body = mockCreateMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("filterSql");
  });

  it("refuses to save an empty SQL filter, marking the field", async () => {
    open({ view: sqlView });
    const field = screen.getByRole("textbox", { name: /sql filter/i });
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Filter is required")).toBeInTheDocument();
  });

  it("shows a stored filter read-only once the plan no longer includes SQL filters", () => {
    mockSqlEntitled = false;
    open({ view: sqlView });
    expect(
      screen.getByRole("textbox", { name: /sql filter/i })
    ).toHaveAttribute("readonly");
    expect(
      screen.getByText(/no longer includes SQL filters/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Suggest" })
    ).not.toBeInTheDocument();
  });

  it("previews the draft against the view being edited", async () => {
    mockPreviewMutateAsync.mockResolvedValue({
      columns: [
        { key: "age", normalizedKey: "age", label: "Age", type: "number" },
      ],
      records: [{ _record_id: "r1", age: 42 }],
      hasMore: false,
    });
    open({ view: sqlView });
    await userEvent.click(screen.getByRole("button", { name: "Run preview" }));
    expect(mockPreviewMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorEntityId: "ent-1",
        filterSql: "age > 30",
        curatedViewId: "view-1",
      })
    );
    expect(await screen.findByText("42")).toBeInTheDocument();
  });

  it("puts a suggestion in the editor and previews it", async () => {
    mockSuggestMutateAsync.mockResolvedValue({
      filterSql: "age > 40",
      warning: null,
    });
    mockPreviewMutateAsync.mockResolvedValue({
      columns: [],
      records: [],
      hasMore: false,
    });
    open({ view: sqlView });
    await userEvent.type(
      screen.getByRole("textbox", { name: /describe the rows/i }),
      "over forty"
    );
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    expect(await screen.findByDisplayValue("age > 40")).toBeInTheDocument();
    expect(mockPreviewMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ filterSql: "age > 40" })
    );
  });
});
