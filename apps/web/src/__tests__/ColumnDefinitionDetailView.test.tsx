import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  ColumnDefinitionGetResponsePayload,
  FieldMappingListResponsePayload,
} from "@portalai/core/contracts";
import type { ColumnDefinition, FieldMapping } from "@portalai/core/models";
import type { ApiError } from "../utils";

type GetQuery = UseQueryResult<ColumnDefinitionGetResponsePayload, ApiError>;
type ListQuery = UseQueryResult<FieldMappingListResponsePayload, ApiError>;

let currentGetQuery: Partial<GetQuery> = {};
let currentFieldMappingListQuery: Partial<ListQuery> = {};
const noopMutation = { mutate: jest.fn(), isPending: false, error: null };

const noopSearch = () => ({
  onSearch: jest.fn(() => Promise.resolve([])),
  onSearchPending: false,
  onSearchError: null,
  getById: jest.fn(() => Promise.resolve(null)),
  getByIdPending: false,
  getByIdError: null,
  labelMap: {},
});

// #689: the caller's type-level permissions (field-mapping create).
let currentResourcePermissions: Record<string, Record<string, boolean>> = {};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: {
      current: () => ({
        data: { resourcePermissions: currentResourcePermissions },
      }),
    },
    columnDefinitions: {
      get: () => currentGetQuery,
      update: () => noopMutation,
      delete: () => noopMutation,
      impact: () => ({ data: null, isLoading: false }),
      search: noopSearch,
    },
    connectorEntities: {
      search: noopSearch,
    },
    fieldMappings: {
      list: () => currentFieldMappingListQuery,
      create: () => noopMutation,
      update: () => noopMutation,
      delete: () => noopMutation,
      impact: () => ({ data: null, isLoading: false }),
      searchWithEntity: noopSearch,
    },
  },
  queryKeys: {
    columnDefinitions: { root: ["columnDefinitions"] },
    fieldMappings: { root: ["fieldMappings"] },
  },
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { ColumnDefinitionDetailView } =
  await import("../views/ColumnDefinitionDetail.view");

// GET rows carry the caller's `capabilities` (#688).
const makeColumnDefinition = (
  overrides: Partial<ColumnDefinition> & {
    capabilities?: { read: boolean; write: boolean; delete: boolean };
  } = {}
): ColumnDefinition & {
  capabilities: { read: boolean; write: boolean; delete: boolean };
} => ({
  capabilities: { read: true, write: true, delete: true },
  id: "cd-1",
  organizationId: "org-1",
  key: "first_name",
  label: "First Name",
  type: "string",
  description: null,
  validationPattern: null,
  validationMessage: null,
  canonicalFormat: null,
  system: false,
  geoRole: null,
  created: 1735689600000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

// List rows carry the caller's `capabilities` (#688).
const makeFieldMapping = (
  overrides: Partial<FieldMapping> = {}
): FieldMapping & {
  capabilities: { read: boolean; write: boolean; delete: boolean };
} => ({
  capabilities: { read: true, write: true, delete: true },
  id: "fm-1",
  organizationId: "org-1",
  connectorEntityId: "ce-1",
  columnDefinitionId: "cd-1",
  sourceField: "email",
  normalizedKey: "email",
  required: false,
  defaultValue: null,
  format: null,
  enumValues: null,
  isPrimaryKey: false,
  refNormalizedKey: null,
  refEntityKey: null,
  created: 1735689600000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

describe("ColumnDefinitionDetailView", () => {
  beforeEach(() => {
    currentGetQuery = {};
    currentFieldMappingListQuery = {};
    currentResourcePermissions = { field_mapping: { write: true } };
  });

  it("should display loading state when query is loading", () => {
    currentGetQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
    } as Partial<GetQuery>;

    render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should display metadata section with all column definition fields", () => {
    const cd = makeColumnDefinition({
      label: "Email Address",
      key: "email_address",
      type: "string",
      description: "Primary email",
      validationPattern: "^.+@.+$",
      canonicalFormat: "RFC5322",
    });
    currentGetQuery = {
      data: { columnDefinition: cd },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;
    currentFieldMappingListQuery = {
      data: { fieldMappings: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
    expect(
      screen.getByRole("heading", { name: "Email Address" })
    ).toBeInTheDocument();
    expect(screen.getByText("email_address")).toBeInTheDocument();
    expect(screen.getByText("string")).toBeInTheDocument();
    expect(screen.getByText(/Primary email/)).toBeInTheDocument();
    expect(screen.getByText("RFC5322")).toBeInTheDocument();
    expect(screen.getByText("^.+@.+$")).toBeInTheDocument();
  });

  // #414: this view carried its own byte-identical copy of TYPE_COLOR, also
  // missing `geometry`. Both now import the one exhaustive map.
  it("should render a geometry type chip with a mapped colour", () => {
    const cd = makeColumnDefinition({
      label: "Boundary",
      key: "boundary",
      type: "geometry",
    });
    currentGetQuery = {
      data: { columnDefinition: cd },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;
    currentFieldMappingListQuery = {
      data: { fieldMappings: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);

    const chip = screen.getByText("geometry").closest(".MuiChip-root");
    expect(chip).toBeInTheDocument();
    expect(chip?.className).not.toContain("colorDefault");
    expect(chip?.className).toContain("colorSuccess");
  });

  it("should display field mappings table with mock data", () => {
    const cd = makeColumnDefinition();
    const fm1 = makeFieldMapping({
      id: "fm-1",
      sourceField: "user_email",
      connectorEntityId: "ce-100",
      isPrimaryKey: false,
    });
    const fm2 = makeFieldMapping({
      id: "fm-2",
      sourceField: "user_id",
      connectorEntityId: "ce-200",
      isPrimaryKey: true,
    });

    currentGetQuery = {
      data: { columnDefinition: cd },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;
    currentFieldMappingListQuery = {
      data: { fieldMappings: [fm1, fm2], total: 2, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
    expect(screen.getByText("user_email")).toBeInTheDocument();
    expect(screen.getByText("ce-100")).toBeInTheDocument();
    expect(screen.getByText("user_id")).toBeInTheDocument();
    expect(screen.getByText("ce-200")).toBeInTheDocument();
    // Primary key check icon should be present (at least one CheckIcon via testId)
    expect(screen.getByText("Field Mappings")).toBeInTheDocument();
  });

  it("should display new field mapping columns: normalizedKey, required, defaultValue, format, enumValues", () => {
    const cd = makeColumnDefinition();
    const fm1 = makeFieldMapping({
      id: "fm-1",
      sourceField: "raw_status",
      normalizedKey: "status",
      required: true,
      defaultValue: "active",
      format: "lowercase",
      enumValues: ["active", "inactive"],
      connectorEntityId: "ce-100",
    });

    currentGetQuery = {
      data: { columnDefinition: cd },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;
    currentFieldMappingListQuery = {
      data: { fieldMappings: [fm1], total: 1, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
    // Column headers
    expect(screen.getByText("Normalized Key")).toBeInTheDocument();
    expect(screen.getByText("Default Value")).toBeInTheDocument();
    // Cell values
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("lowercase")).toBeInTheDocument();
    expect(screen.getByText("active, inactive")).toBeInTheDocument();
  });

  it("should display empty state when no field mappings exist", () => {
    const cd = makeColumnDefinition();
    currentGetQuery = {
      data: { columnDefinition: cd },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;
    currentFieldMappingListQuery = {
      data: { fieldMappings: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
    expect(screen.getByText(/No field mappings found/)).toBeInTheDocument();
  });

  it("should display error state for invalid column definition ID", () => {
    currentGetQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      error: new Error("Not found") as unknown as ApiError,
    } as Partial<GetQuery>;

    render(<ColumnDefinitionDetailView columnDefinitionId="invalid-id" />);
    expect(screen.getByText(/Not found/)).toBeInTheDocument();
  });

  it("should display breadcrumbs with correct label", () => {
    const cd = makeColumnDefinition({ label: "My Column" });
    currentGetQuery = {
      data: { columnDefinition: cd },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;
    currentFieldMappingListQuery = {
      data: { fieldMappings: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
    const breadcrumbNav = screen.getByRole("navigation", {
      name: "breadcrumb",
    });
    expect(breadcrumbNav).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    // "Column Definitions" appears as a breadcrumb link
    const breadcrumbLinks = breadcrumbNav.querySelectorAll("a");
    expect(breadcrumbLinks).toHaveLength(2);
    // "My Column" appears in both breadcrumb and heading
    expect(screen.getAllByText("My Column")).toHaveLength(2);
  });

  describe("System vs. Custom column definition", () => {
    beforeEach(() => {
      currentFieldMappingListQuery = {
        data: { fieldMappings: [], total: 0, limit: 10, offset: 0 },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as Partial<ListQuery>;
    });

    it("disables Edit and hides Delete when the column definition is system", async () => {
      const cd = makeColumnDefinition({ system: true });
      currentGetQuery = {
        data: { columnDefinition: cd },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as Partial<GetQuery>;

      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);

      // #689: disabled with a reason the tooltip can show (a native
      // `disabled` button never fires hover, so `title` was never seen).
      const edit = screen.getByRole("button", { name: /edit/i });
      expect(edit).toHaveAttribute("aria-disabled", "true");
      fireEvent.mouseOver(edit);
      expect(
        await screen.findByText("System column definitions are read-only")
      ).toBeInTheDocument();

      // Secondary actions menu (which hosts Delete) is absent when empty.
      expect(
        screen.queryByRole("button", { name: /more actions/i })
      ).not.toBeInTheDocument();
    });

    it("renders no Edit or Delete for a caller who can only read it (#689)", () => {
      const cd = makeColumnDefinition({
        capabilities: { read: true, write: false, delete: false },
      });
      currentGetQuery = {
        data: { columnDefinition: cd },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as Partial<GetQuery>;

      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);

      expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /more actions/i })
      ).not.toBeInTheDocument();
    });

    it("keeps Edit enabled and renders the Delete menu for custom column definitions", () => {
      const cd = makeColumnDefinition({ system: false });
      currentGetQuery = {
        data: { columnDefinition: cd },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as Partial<GetQuery>;

      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);

      const edit = screen.getByRole("button", { name: /edit/i });
      expect(edit).not.toBeDisabled();

      const moreActions = screen.getByRole("button", { name: /more actions/i });
      expect(moreActions).toBeInTheDocument();
    });
  });

  describe("Create Field Mapping", () => {
    beforeEach(() => {
      const cd = makeColumnDefinition({ label: "First Name" });
      currentGetQuery = {
        data: { columnDefinition: cd },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as Partial<GetQuery>;
      currentFieldMappingListQuery = {
        data: { fieldMappings: [], total: 0, limit: 10, offset: 0 },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as Partial<ListQuery>;
    });

    it("should display Create button in the Field Mappings section", () => {
      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
      expect(
        screen.getByRole("button", { name: /Create/ })
      ).toBeInTheDocument();
    });

    it("should open create dialog when Create button is clicked", () => {
      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
      fireEvent.click(screen.getByRole("button", { name: /Create/ }));
      expect(screen.getByText("New Field Mapping")).toBeInTheDocument();
    });

    it("should show locked column definition label in create dialog", () => {
      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);
      fireEvent.click(screen.getByRole("button", { name: /Create/ }));
      const cdField = screen.getByDisplayValue("First Name");
      expect(cdField).toBeDisabled();
    });
  });

  describe("Write capability gating for field mappings", () => {
    const setupWithCapability = (
      enabledCapabilityFlags: { write?: boolean } | null,
      capabilities = { read: true, write: true, delete: true }
    ) => {
      const cd = makeColumnDefinition();
      const fm = {
        ...makeFieldMapping({
          id: "fm-1",
          sourceField: "email",
          connectorEntityId: "ce-1",
        }),
        capabilities,
        connectorEntity: {
          id: "ce-1",
          organizationId: "org-1",
          connectorInstanceId: "inst-1",
          key: "contacts",
          label: "Contacts",
          created: Date.now(),
          createdBy: "system",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
          connectorInstance: { id: "inst-1", enabledCapabilityFlags },
        },
      };

      currentGetQuery = {
        data: { columnDefinition: cd },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as Partial<GetQuery>;

      currentFieldMappingListQuery = {
        data: { fieldMappings: [fm], total: 1, limit: 10, offset: 0 },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as Partial<ListQuery>;
    };

    it("disables field mapping edit/delete, naming why, when the connector's writes are off", () => {
      setupWithCapability({ write: false });
      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);

      for (const label of ["Edit field mapping", "Delete field mapping"]) {
        expect(screen.getByLabelText(label)).toHaveAttribute(
          "aria-disabled",
          "true"
        );
      }
    });

    it("shows field mapping edit/delete buttons when write is enabled", () => {
      setupWithCapability({ write: true });
      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);

      expect(screen.getByLabelText("Edit field mapping")).not.toHaveAttribute(
        "aria-disabled"
      );
      expect(screen.getByLabelText("Delete field mapping")).toBeInTheDocument();
    });

    it("hides field mapping edit/delete the caller can't perform on the row (#689)", () => {
      setupWithCapability(
        { write: true },
        { read: true, write: false, delete: false }
      );
      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);

      expect(
        screen.queryByLabelText("Edit field mapping")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Delete field mapping")
      ).not.toBeInTheDocument();
    });

    it("hides the field mapping Create without field_mapping create (#689)", () => {
      currentResourcePermissions = {};
      setupWithCapability({ write: true });
      render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />);

      expect(
        screen.queryByRole("button", { name: /^Create$/ })
      ).not.toBeInTheDocument();
    });
  });
});
