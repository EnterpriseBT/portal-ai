import { jest } from "@jest/globals";

import { render, screen, act } from "../../../__tests__/test-utils";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnMappingStep } from "../ColumnMappingStep.component";
import type {
  RecommendedColumn,
  RecommendedEntity,
} from "../utils/upload-workflow.util";
import type { ColumnDefinition } from "@portalai/core/models";
import type { ColumnStepErrors } from "../utils/file-upload-validation.util";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const mockColumnDefsByKey: Record<string, ColumnDefinition> = {
  email: {
    id: "col_001",
    key: "email",
    label: "Email",
    type: "string",
    description: "Email address",
    validationPattern: "^[^@]+@[^@]+$",
    validationMessage: "Must be valid email",
    canonicalFormat: "lowercase",
    organizationId: "org-1",
    system: false,
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  name: {
    id: "col_002",
    key: "name",
    label: "Name",
    type: "string",
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: "trim",
    organizationId: "org-1",
    system: false,
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  role_id: {
    id: "col_003",
    key: "role_id",
    label: "Role ID",
    type: "reference",
    description: "Reference to roles",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    organizationId: "org-1",
    system: false,
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  status: {
    id: "col_004",
    key: "status",
    label: "Status",
    type: "enum",
    description: "Current status",
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    organizationId: "org-1",
    system: false,
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
};

const MOCK_COLUMN_HIGH: RecommendedColumn = {
  confidence: 0.95,
  existingColumnDefinitionId: "col_001",
  existingColumnDefinitionKey: "email",
  sourceField: "Email Address",
  isPrimaryKeyCandidate: true,
  sampleValues: ["alice@example.com", "bob@test.org", "carol@acme.io"],
  normalizedKey: "email_address",
  required: true,
  format: "email",
  enumValues: null,
  defaultValue: null,
};

const MOCK_COLUMN_MED: RecommendedColumn = {
  confidence: 0.65,
  existingColumnDefinitionId: "col_002",
  existingColumnDefinitionKey: "name",
  sourceField: "Full Name",
  isPrimaryKeyCandidate: false,
  sampleValues: ["Alice Smith", "Bob Jones"],
  normalizedKey: "full_name",
  required: false,
  format: null,
  enumValues: null,
  defaultValue: null,
};

const MOCK_COLUMN_LOW: RecommendedColumn = {
  confidence: 0.3,
  existingColumnDefinitionId: "",
  existingColumnDefinitionKey: "",
  sourceField: "Phone Number",
  isPrimaryKeyCandidate: false,
  sampleValues: ["+1-555-0100", "+1-555-0101"],
  normalizedKey: "phone_number",
  required: false,
  format: null,
  enumValues: null,
  defaultValue: null,
};

const MOCK_ENTITY_A: RecommendedEntity = {
  connectorEntity: { key: "contacts", label: "Contacts" },
  sourceFileName: "contacts.csv",
  columns: [MOCK_COLUMN_HIGH, MOCK_COLUMN_LOW],
};

const MOCK_ENTITY_B: RecommendedEntity = {
  connectorEntity: { key: "products", label: "Products" },
  sourceFileName: "products.csv",
  columns: [MOCK_COLUMN_MED],
};

// ---------------------------------------------------------------------------
// Default search props (no-op for most tests)
// ---------------------------------------------------------------------------

// Search mock returns options with columnDefinition attached for cache population
const mockSearchResults = Object.values(mockColumnDefsByKey).map((cd) => ({
  value: cd.id,
  label: `${cd.label} (${cd.key}) — ${cd.type}`,
  columnDefinition: cd,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnColumnKeySearch = jest.fn<any>().mockResolvedValue(mockSearchResults);

const mockColumnDefsById = Object.fromEntries(
  Object.values(mockColumnDefsByKey).map((cd) => [cd.id, cd])
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnColumnKeyGetById = jest.fn<any>().mockImplementation(
  async (id: string) => {
    const cd = mockColumnDefsById[id];
    if (!cd) return null;
    return { value: cd.id, label: `${cd.label} (${cd.key}) — ${cd.type}`, columnDefinition: cd };
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Renders ColumnMappingStep and waits for the initial search effect to populate definitions. */
async function renderAndWait(...args: Parameters<typeof render>) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(...args);
    // Wait for the initial useEffect search to resolve and state to update
    await new Promise((r) => setTimeout(r, 0));
  });
  return result!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ColumnMappingStep", () => {
  describe("Empty state", () => {
    it("shows no-entities message when entities array is empty", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(
        screen.getByText(
          "No entities available. Please go back and review entities."
        )
      ).toBeInTheDocument();
    });
  });

  describe("Tabbed layout", () => {
    it("renders one tab per entity", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A, MOCK_ENTITY_B]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getByRole("tab", { name: "Contacts" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Products" })).toBeInTheDocument();
    });

    it("shows first entity tab content by default", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A, MOCK_ENTITY_B]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      // First entity columns visible
      expect(screen.getByText("Email Address")).toBeInTheDocument();
      expect(screen.getByText("Phone Number")).toBeInTheDocument();
    });

    it("switches tab content when clicking another tab", async () => {
      const user = userEvent.setup();
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A, MOCK_ENTITY_B]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      await user.click(screen.getByRole("tab", { name: "Products" }));

      expect(screen.getByText("Full Name")).toBeInTheDocument();
    });
  });

  describe("Column rows", () => {
    it("displays source field for each column", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getByText("Email Address")).toBeInTheDocument();
      expect(screen.getByText("Phone Number")).toBeInTheDocument();
    });

    it("displays column count", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getByText("2 columns")).toBeInTheDocument();
    });

    it("displays sample values", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
    });

    it("renders AsyncSearchableSelect for column definition selection", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      // Two columns, each with a "Column Definition" autocomplete
      const defInputs = screen.getAllByLabelText(/column definition/i);
      expect(defInputs.length).toBe(2);
    });

    it("displays read-only type and description when column has a matched definition", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      // MOCK_COLUMN_HIGH matches "email" column def with type "string" and description "Email address"
      expect(screen.getByText("string")).toBeInTheDocument();
      expect(screen.getByText("Email address")).toBeInTheDocument();
    });

    it("displays read-only validation pattern and canonical format when definition has them", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      // email column def has validationPattern and canonicalFormat
      expect(screen.getByText(/\^.*@.*\$/)).toBeInTheDocument();
      expect(screen.getByText(/lowercase/)).toBeInTheDocument();
    });

    it("shows 'Select a column definition' prompt when no definition is matched", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      // MOCK_COLUMN_LOW has empty existingColumnDefinitionId
      expect(screen.getByText("Select a column definition")).toBeInTheDocument();
    });

    it("renders field-mapping editors: normalizedKey, format, required, primary key", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getAllByLabelText(/normalized key/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByLabelText(/^format$/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/primary key/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/required/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Confidence badge", () => {
    it("renders confidence percentage", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getByText("95%")).toBeInTheDocument();
      expect(screen.getByText("30%")).toBeInTheDocument();
    });
  });

  describe("Validation errors", () => {
    it("shows existingColumnDefinitionId error from errors prop", async () => {
      const errors: ColumnStepErrors = {
        0: {
          0: { existingColumnDefinitionId: "Column definition is required" },
        },
      };
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          errors={errors}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getByText("Column definition is required")).toBeInTheDocument();
    });

    it("shows normalizedKey error from errors prop", async () => {
      const errors: ColumnStepErrors = {
        0: {
          0: { normalizedKey: "Normalized key is required" },
        },
      };
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          errors={errors}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getByText("Normalized key is required")).toBeInTheDocument();
    });
  });

  describe("Editing columns", () => {
    it("selecting a definition calls onUpdateColumn with existingColumnDefinitionId", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      // Mock search to return a result
      const mockSearch = jest.fn<() => Promise<{ value: string; label: string }[]>>().mockResolvedValue([
        { value: "col_002", label: "Name (name)" },
      ]);

      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
          onColumnKeySearch={mockSearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}
        />
      );

      // The first Column Definition input corresponds to MOCK_COLUMN_HIGH
      const defInputs = screen.getAllByLabelText(/column definition/i);
      await user.clear(defInputs[0]);
      await user.type(defInputs[0], "name");

      // Wait for search results to appear, then click the option
      const option = await screen.findByText("Name (name)");
      await user.click(option);

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0, // entityIndex
        0, // columnIndex
        expect.objectContaining({
          existingColumnDefinitionId: "col_002",
        })
      );
    });

    it("primary key checkbox toggle fires onUpdateColumn", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      const checkboxes = screen.getAllByRole("checkbox");
      // The first primary key checkbox corresponds to MOCK_COLUMN_HIGH (isPrimaryKeyCandidate: true)
      await user.click(checkboxes[0]);

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0, // entityIndex
        0, // columnIndex
        expect.objectContaining({
          isPrimaryKeyCandidate: expect.any(Boolean),
        })
      );
    });

    it("fires onUpdateColumn with format on change", async () => {
      const onUpdateColumn = jest.fn();
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      const formatInputs = screen.getAllByLabelText(/^format$/i);
      fireEvent.change(formatInputs[0], { target: { value: "DD/MM/YYYY" } });
      fireEvent.blur(formatInputs[0]);
      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          format: "DD/MM/YYYY",
        })
      );
    });

    it("fires onUpdateColumn with normalizedKey on change", async () => {
      const onUpdateColumn = jest.fn();
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      const nkInputs = screen.getAllByLabelText(/normalized key/i);
      fireEvent.change(nkInputs[0], { target: { value: "new_key" } });
      fireEvent.blur(nkInputs[0]);
      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          normalizedKey: "new_key",
        })
      );
    });
  });

  describe("Reference editor", () => {
    const refColumn: RecommendedColumn = {
      confidence: 0.9,
      existingColumnDefinitionId: "col_003",
      existingColumnDefinitionKey: "role_id",
      sourceField: "role_id",
      isPrimaryKeyCandidate: false,
      sampleValues: ["1", "2"],
      normalizedKey: "role_id",
      required: false,
      format: null,
      enumValues: null,
      defaultValue: null,
      refEntityKey: null,
      refNormalizedKey: null,
    };

    it("shows reference entity and column selects when definition type is reference", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      expect(
        screen.getByRole("combobox", { name: /reference entity/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: /reference column/i })
      ).toBeInTheDocument();
    });

    it("does not show reference editor for non-reference columns", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      expect(
        screen.queryByRole("combobox", { name: /reference entity/i })
      ).not.toBeInTheDocument();
    });

    it("entity select is populated with all entities", async () => {
      const user = userEvent.setup();
      await renderAndWait(
        <ColumnMappingStep
          entities={[
            { ...MOCK_ENTITY_A, columns: [refColumn] },
            MOCK_ENTITY_B,
          ]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      const entitySelect = screen.getByRole("combobox", {
        name: /reference entity/i,
      });
      await user.click(entitySelect);

      expect(
        screen.getByRole("option", { name: /Contacts/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: /Products/i })
      ).toBeInTheDocument();
    });

    it("selecting a reference entity fires onUpdateColumn with refEntityKey", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      await renderAndWait(
        <ColumnMappingStep
          entities={[
            { ...MOCK_ENTITY_A, columns: [refColumn] },
            MOCK_ENTITY_B,
          ]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      const entitySelect = screen.getByRole("combobox", {
        name: /reference entity/i,
      });
      await user.click(entitySelect);
      await user.click(screen.getByRole("option", { name: /Products/i }));

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          refEntityKey: "products",
          refNormalizedKey: null,
        })
      );
    });

    it("column select is disabled when no entity is selected", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      const columnSelect = screen.getByRole("combobox", {
        name: /reference column/i,
      });
      expect(columnSelect).toHaveAttribute("aria-disabled", "true");
    });

    it("entity select is disabled while loading DB entities", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={true}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      const entitySelect = screen.getByRole("combobox", {
        name: /reference entity/i,
      });
      expect(entitySelect).toHaveAttribute("aria-disabled", "true");
    });

    it("DB entities appear in entity select options", async () => {
      const user = userEvent.setup();
      const mockDbEntity = {
        id: "ce_db_001",
        organizationId: "org_1",
        connectorInstanceId: "ci_1",
        key: "roles",
        label: "Roles",
        created: 0,
        updated: null,
        createdBy: "system",
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        fieldMappings: [],
      };

      await renderAndWait(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[mockDbEntity]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      const entitySelect = screen.getByRole("combobox", {
        name: /reference entity/i,
      });
      await user.click(entitySelect);

      expect(
        screen.getByRole("option", { name: /Roles.*existing/i })
      ).toBeInTheDocument();
    });

    it("selecting a DB entity column sets refNormalizedKey", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      const mockDbEntity = {
        id: "ce_db_001",
        organizationId: "org_1",
        connectorInstanceId: "ci_1",
        key: "roles",
        label: "Roles",
        created: 0,
        updated: null,
        createdBy: "system",
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        fieldMappings: [
          {
            id: "fm_001",
            organizationId: "org_1",
            connectorEntityId: "ce_db_001",
            sourceField: "id",
            columnDefinitionId: "cd_001",
            isPrimaryKey: true,
            normalizedKey: "role_id",
            required: false,
            defaultValue: null,
            format: null,
            enumValues: null,
            refNormalizedKey: null,
            refEntityKey: null,
            created: 0,
            updated: null,
            createdBy: "system",
            updatedBy: null,
            deleted: null,
            deletedBy: null,
            columnDefinition: {
              id: "cd_001",
              organizationId: "org_1",
              key: "id",
              label: "ID",
              type: "string" as const,
              description: null,
              validationPattern: null,
              validationMessage: null,
              canonicalFormat: null,
              system: false,
              created: 0,
              updated: null,
              createdBy: "system",
              updatedBy: null,
              deleted: null,
              deletedBy: null,
            },
          },
        ],
      };

      // refColumn with refEntityKey set to a DB-only entity (not in batch)
      const refColumnInDbMode: RecommendedColumn = {
        ...refColumn,
        refEntityKey: "roles",
        refNormalizedKey: null,
      };

      await renderAndWait(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumnInDbMode] }]}
          dbEntities={[mockDbEntity]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );

      const columnSelect = screen.getByRole("combobox", {
        name: /reference column/i,
      });
      await user.click(columnSelect);
      // DB mode now shows normalizedKey (sourceField) — "role_id (id)"
      await user.click(screen.getByRole("option", { name: /role_id/i }));

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          refNormalizedKey: "role_id",
        })
      );
    });
  });

  describe("Enum values editor", () => {
    it("shows enum values input when column definition type is enum", async () => {
      const enumColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        existingColumnDefinitionId: "col_004",
        existingColumnDefinitionKey: "status",
        normalizedKey: "status",
        enumValues: ["active", "inactive"],
      };
      await renderAndWait(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [enumColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getByLabelText(/enum values/i)).toBeInTheDocument();
    });

    it("does not show enum values input when column definition type is not enum", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.queryByLabelText(/enum values/i)).not.toBeInTheDocument();
    });
  });

  describe("Format editor", () => {
    it("shows format input for columns", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      expect(screen.getAllByLabelText(/^format$/i).length).toBeGreaterThanOrEqual(1);
    });

    it("pre-populates format input with existing value", async () => {
      await renderAndWait(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          onColumnKeySearch={mockOnColumnKeySearch}
          onColumnKeyGetById={mockOnColumnKeyGetById}

        />
      );
      // MOCK_COLUMN_HIGH has format "email" — find the Format input specifically
      const formatInputs = screen.getAllByDisplayValue("email");
      expect(formatInputs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
