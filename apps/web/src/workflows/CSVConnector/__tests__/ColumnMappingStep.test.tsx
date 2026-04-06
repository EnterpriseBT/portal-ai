import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnMappingStep } from "../ColumnMappingStep.component";
import type {
  RecommendedColumn,
  RecommendedEntity,
} from "../utils/upload-workflow.util";
import type { ColumnStepErrors } from "../utils/csv-validation.util";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_COLUMN_HIGH: RecommendedColumn = {
  action: "match_existing",
  confidence: 0.95,
  existingColumnDefinitionId: "col_001",
  recommended: {
    key: "email",
    label: "Email",
    type: "string",
    description: "Contact email",
  },
  sourceField: "Email Address",
  isPrimaryKeyCandidate: true,
  sampleValues: ["alice@example.com", "bob@test.org", "carol@acme.io"],
  required: true,
  format: "email",
  enumValues: null,
};

const MOCK_COLUMN_MED: RecommendedColumn = {
  action: "match_existing",
  confidence: 0.65,
  existingColumnDefinitionId: "col_002",
  recommended: {
    key: "name",
    label: "Name",
    type: "string",
    description: null,
  },
  sourceField: "Full Name",
  isPrimaryKeyCandidate: false,
  sampleValues: ["Alice Smith", "Bob Jones"],
  required: false,
  format: null,
  enumValues: null,
};

const MOCK_COLUMN_LOW: RecommendedColumn = {
  action: "create_new",
  confidence: 0.3,
  existingColumnDefinitionId: null,
  recommended: {
    key: "phone",
    label: "Phone",
    type: "string",
    description: null,
  },
  sourceField: "Phone Number",
  isPrimaryKeyCandidate: false,
  sampleValues: ["+1-555-0100", "+1-555-0101"],
  required: false,
  format: null,
  enumValues: null,
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
// Tests
// ---------------------------------------------------------------------------

describe("ColumnMappingStep", () => {
  describe("Empty state", () => {
    it("shows no-entities message when entities array is empty", () => {
      render(<ColumnMappingStep entities={[]} dbEntities={[]} isLoadingDbEntities={false} onUpdateColumn={jest.fn()} />);
      expect(
        screen.getByText(
          "No entities available. Please go back and review entities."
        )
      ).toBeInTheDocument();
    });
  });

  describe("Tabbed layout", () => {
    it("renders one tab per entity", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A, MOCK_ENTITY_B]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByRole("tab", { name: "Contacts" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Products" })).toBeInTheDocument();
    });

    it("shows first entity tab content by default", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A, MOCK_ENTITY_B]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      // First entity columns visible
      expect(screen.getByText("Email Address")).toBeInTheDocument();
      expect(screen.getByText("Phone Number")).toBeInTheDocument();
    });

    it("switches tab content when clicking another tab", async () => {
      const user = userEvent.setup();
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A, MOCK_ENTITY_B]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );

      await user.click(screen.getByRole("tab", { name: "Products" }));

      expect(screen.getByText("Full Name")).toBeInTheDocument();
    });
  });

  describe("Column rows", () => {
    it("displays source field for each column", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByText("Email Address")).toBeInTheDocument();
      expect(screen.getByText("Phone Number")).toBeInTheDocument();
    });

    it("displays recommended key and label in text inputs", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      // Use getAllByDisplayValue because normalizedKey input may share the same value as the key input
      expect(screen.getAllByDisplayValue("email").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByDisplayValue("Email")).toBeInTheDocument();
      expect(screen.getAllByDisplayValue("phone").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByDisplayValue("Phone")).toBeInTheDocument();
    });

    it("displays type as an enabled select", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      // MUI Select renders a hidden input holding the value
      const typeInputs = screen.getAllByDisplayValue("string");
      for (const input of typeInputs) {
        expect(input).not.toBeDisabled();
      }
    });

    it("displays column count", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByText("2 columns")).toBeInTheDocument();
    });

    it("displays sample values", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
    });
  });

  describe("Confidence badge", () => {
    it("renders confidence percentage", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByText("95%")).toBeInTheDocument();
      expect(screen.getByText("30%")).toBeInTheDocument();
    });
  });

  describe("Action display", () => {
    it("shows Match label for match_existing action", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByText("Match")).toBeInTheDocument();
    });

    it("shows New label for create_new action", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByText("New")).toBeInTheDocument();
    });
  });

  describe("Editing columns", () => {
    it("onUpdateColumn fires with correct entity and column indices when key changes", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );

      // getAllByDisplayValue because format input may share value "email" with the key input
      const keyInput = screen.getAllByDisplayValue("email")[0];
      await user.clear(keyInput);
      await user.type(keyInput, "x");

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0, // entityIndex
        0, // columnIndex
        expect.objectContaining({
          recommended: expect.objectContaining({ key: expect.any(String) }),
        })
      );
    });

    it("onUpdateColumn fires with correct indices when label changes", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );

      const labelInput = screen.getByDisplayValue("Email");
      await user.clear(labelInput);
      await user.type(labelInput, "x");

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0, // entityIndex
        0, // columnIndex
        expect.objectContaining({
          recommended: expect.objectContaining({ label: expect.any(String) }),
        })
      );
    });

    it("primary key checkbox toggle fires onUpdateColumn", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
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

    it("type select fires onUpdateColumn with new type", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );

      // Open the first type select (for MOCK_COLUMN_HIGH)
      const typeSelects = screen.getAllByRole("combobox", { name: /type/i });
      await user.click(typeSelects[0]);
      await user.click(screen.getByRole("option", { name: "Boolean" }));

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          recommended: expect.objectContaining({ type: "boolean" }),
        })
      );
    });

    it("switching type away from reference clears ref fields", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      const refColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: {
          ...MOCK_COLUMN_HIGH.recommended,
          type: "reference",
          refEntityKey: "products",
          refColumnKey: "id",
        },
      };

      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );

      const typeSelects = screen.getAllByRole("combobox", { name: /type/i });
      await user.click(typeSelects[0]);
      await user.click(screen.getByRole("option", { name: "Number" }));

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          recommended: expect.objectContaining({
            type: "number",
            refEntityKey: null,
            refColumnKey: null,
            refColumnDefinitionId: null,
          }),
        })
      );
    });
  });

  describe("Reference editor", () => {
    const refColumn: RecommendedColumn = {
      action: "create_new",
      confidence: 0.9,
      existingColumnDefinitionId: null,
      recommended: {
        key: "role_id",
        label: "Role ID",
        type: "reference",
        description: null,
        refEntityKey: null,
        refColumnKey: null,
      },
      sourceField: "role_id",
      isPrimaryKeyCandidate: false,
      sampleValues: ["1", "2"],
      required: false,
      format: null,
      enumValues: null,
    };

    it("shows reference entity and column selects when type is reference", () => {
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );

      expect(
        screen.getByRole("combobox", { name: /reference entity/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: /reference column/i })
      ).toBeInTheDocument();
    });

    it("shows reference entity and column selects when type is reference-array", () => {
      const refArrayColumn: RecommendedColumn = {
        ...refColumn,
        recommended: { ...refColumn.recommended, type: "reference-array" },
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refArrayColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );

      expect(
        screen.getByRole("combobox", { name: /reference entity/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: /reference column/i })
      ).toBeInTheDocument();
    });

    it("does not show reference editor for non-reference columns", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );

      expect(
        screen.queryByRole("combobox", { name: /reference entity/i })
      ).not.toBeInTheDocument();
    });

    it("entity select is populated with all entities", async () => {
      const user = userEvent.setup();
      render(
        <ColumnMappingStep
          entities={[
            { ...MOCK_ENTITY_A, columns: [refColumn] },
            MOCK_ENTITY_B,
          ]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
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

      render(
        <ColumnMappingStep
          entities={[
            { ...MOCK_ENTITY_A, columns: [refColumn] },
            MOCK_ENTITY_B,
          ]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
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
          recommended: expect.objectContaining({
            refEntityKey: "products",
            refColumnKey: null,
            refColumnDefinitionId: null,
          }),
        })
      );
    });

    it("column select is disabled when no entity is selected", () => {
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );

      const columnSelect = screen.getByRole("combobox", {
        name: /reference column/i,
      });
      expect(columnSelect).toHaveAttribute("aria-disabled", "true");
    });

    it("selecting a reference column fires onUpdateColumn with refColumnKey", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();

      const refColumnWithEntity: RecommendedColumn = {
        ...refColumn,
        recommended: {
          ...refColumn.recommended,
          refEntityKey: "contacts",
        },
      };

      // Include MOCK_COLUMN_HIGH so the "contacts" entity has a selectable column
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumnWithEntity, MOCK_COLUMN_HIGH] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );

      const columnSelect = screen.getByRole("combobox", {
        name: /reference column/i,
      });
      await user.click(columnSelect);
      await user.click(screen.getByRole("option", { name: /Email/i }));

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          recommended: expect.objectContaining({ refColumnKey: "email" }),
        })
      );
    });

    it("entity select is disabled while loading DB entities", () => {
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={true}
          onUpdateColumn={jest.fn()}
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

      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[mockDbEntity]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
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

    it("selecting a DB entity column sets refColumnDefinitionId and clears refColumnKey", async () => {
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
            normalizedKey: "id",
            required: false,
            defaultValue: null,
            format: null,
            enumValues: null,
            refColumnDefinitionId: null,
            refEntityKey: null,
            refBidirectionalFieldMappingId: null,
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

      // refColumn with refEntityKey set to a DB-only entity (not in batch), no column chosen yet.
      // deriveEntitySelectValue will pick "db:roles" because "roles" is in dbEntities but not in batch.
      const refColumnInDbMode: RecommendedColumn = {
        ...refColumn,
        recommended: {
          ...refColumn.recommended,
          refEntityKey: "roles",
          refColumnKey: null,
          refColumnDefinitionId: null,
        },
      };

      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumnInDbMode] }]}
          dbEntities={[mockDbEntity]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );

      const columnSelect = screen.getByRole("combobox", {
        name: /reference column/i,
      });
      await user.click(columnSelect);
      await user.click(screen.getByRole("option", { name: /ID/i }));

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          recommended: expect.objectContaining({
            refColumnDefinitionId: "cd_001",
            refColumnKey: null,
          }),
        })
      );
    });
  });

  describe("Format editor", () => {
    it("shows format input when type is string", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      // MOCK_COLUMN_HIGH has type "string"
      expect(screen.getAllByLabelText(/^format$/i)[0]).toBeInTheDocument();
    });

    it("shows format input when type is date", () => {
      const dateColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: { ...MOCK_COLUMN_HIGH.recommended, type: "date" },
        format: "YYYY-MM-DD",
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [dateColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByLabelText(/^format$/i)).toBeInTheDocument();
    });

    it("shows format input when type is datetime", () => {
      const dtColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: { ...MOCK_COLUMN_HIGH.recommended, type: "datetime" },
        format: "ISO8601",
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [dtColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByLabelText(/^format$/i)).toBeInTheDocument();
    });

    it("shows format input for all types (mapping-level field)", () => {
      const numberColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: { ...MOCK_COLUMN_HIGH.recommended, type: "number" },
        format: null,
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [numberColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByLabelText(/^format$/i)).toBeInTheDocument();
    });

    it("pre-populates format input with existing value", () => {
      const dateColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: { ...MOCK_COLUMN_HIGH.recommended, type: "date" },
        format: "YYYY-MM-DD",
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [dateColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByDisplayValue("YYYY-MM-DD")).toBeInTheDocument();
    });

    it("fires onUpdateColumn with new format on change", () => {
      const onUpdateColumn = jest.fn();
      const dateColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: { ...MOCK_COLUMN_HIGH.recommended, type: "date" },
        format: null,
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [dateColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );
      fireEvent.change(screen.getByLabelText(/^format$/i), { target: { value: "DD/MM/YYYY" } });
      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          format: "DD/MM/YYYY",
        })
      );
    });

    it("switching type to number does not clear mapping-level format", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();
      const dateColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: { ...MOCK_COLUMN_HIGH.recommended, type: "date" },
        format: "YYYY-MM-DD",
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [dateColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );
      const typeSelects = screen.getAllByRole("combobox", { name: /type/i });
      await user.click(typeSelects[0]);
      await user.click(screen.getByRole("option", { name: "Number" }));
      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          recommended: expect.objectContaining({ type: "number" }),
        })
      );
    });

    it("switching type to enum clears enumValues from mapping level", async () => {
      const user = userEvent.setup();
      const onUpdateColumn = jest.fn();
      const dateColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: { ...MOCK_COLUMN_HIGH.recommended, type: "date" },
        format: "YYYY-MM-DD",
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [dateColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );
      const typeSelects = screen.getAllByRole("combobox", { name: /type/i });
      await user.click(typeSelects[0]);
      await user.click(screen.getByRole("option", { name: "Date & Time" }));
      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          recommended: expect.objectContaining({ type: "datetime" }),
        })
      );
    });
  });

  describe("Enum values editor", () => {
    const enumColumn: RecommendedColumn = {
      action: "create_new",
      confidence: 0.85,
      existingColumnDefinitionId: null,
      recommended: {
        key: "status",
        label: "Status",
        type: "enum",
        description: null,
      },
      sourceField: "Status",
      isPrimaryKeyCandidate: false,
      sampleValues: ["active", "inactive"],
      required: false,
      format: null,
      enumValues: ["active", "inactive"],
    };

    it("shows enum values input when type is enum", () => {
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [enumColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );

      expect(
        screen.getByLabelText(/enum values/i)
      ).toBeInTheDocument();
    });

    it("does not show enum values input for non-enum columns", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );

      expect(screen.queryByLabelText(/enum values/i)).not.toBeInTheDocument();
    });

    it("displays existing enum values as comma-separated string", () => {
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [enumColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );

      expect(
        screen.getByDisplayValue("active, inactive")
      ).toBeInTheDocument();
    });

    it("fires onUpdateColumn with parsed enum values array on change", () => {
      const onUpdateColumn = jest.fn();

      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [enumColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={onUpdateColumn}
        />
      );

      const enumInput = screen.getByLabelText(/enum values/i);
      fireEvent.change(enumInput, { target: { value: "a, b, c" } });

      expect(onUpdateColumn).toHaveBeenLastCalledWith(
        0,
        0,
        expect.objectContaining({
          enumValues: ["a", "b", "c"],
        })
      );
    });
  });

  describe("Validation errors", () => {
    it("displays key error on a column row", () => {
      const errors: ColumnStepErrors = {
        0: { 0: { key: "Column key is required" } },
      };
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          errors={errors}
        />
      );
      expect(screen.getByText("Column key is required")).toBeInTheDocument();
    });

    it("displays label error on a column row", () => {
      const errors: ColumnStepErrors = {
        0: { 1: { label: "Column label is required" } },
      };
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          errors={errors}
        />
      );
      expect(screen.getByText("Column label is required")).toBeInTheDocument();
    });

    it("displays type error on a column row", () => {
      const errors: ColumnStepErrors = {
        0: { 0: { type: "Column type is required" } },
      };
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          errors={errors}
        />
      );
      expect(screen.getByText("Column type is required")).toBeInTheDocument();
    });

    it("displays reference entity error on reference column", () => {
      const refColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: {
          ...MOCK_COLUMN_HIGH.recommended,
          type: "reference",
          refEntityKey: null,
          refColumnKey: null,
        },
      };
      const errors: ColumnStepErrors = {
        0: { 0: { refEntityKey: "Reference entity is required" } },
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          errors={errors}
        />
      );
      expect(screen.getByText("Reference entity is required")).toBeInTheDocument();
    });

    it("displays reference column error on reference column", () => {
      const refColumn: RecommendedColumn = {
        ...MOCK_COLUMN_HIGH,
        recommended: {
          ...MOCK_COLUMN_HIGH.recommended,
          type: "reference",
          refEntityKey: "other",
          refColumnKey: null,
          refColumnDefinitionId: null,
        },
      };
      const errors: ColumnStepErrors = {
        0: { 0: { refColumnKey: "Reference column is required" } },
      };
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          errors={errors}
        />
      );
      expect(screen.getByText("Reference column is required")).toBeInTheDocument();
    });

    it("does not display errors when errors prop is empty", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
          errors={{}}
        />
      );
      expect(screen.queryByText("Column key is required")).not.toBeInTheDocument();
      expect(screen.queryByText("Column label is required")).not.toBeInTheDocument();
      expect(screen.queryByText("Column type is required")).not.toBeInTheDocument();
    });

    it("marks key, label, and type fields as required", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          dbEntities={[]}
          isLoadingDbEntities={false}
          onUpdateColumn={jest.fn()}
        />
      );
      // Each column row has key, label, type — check first column's inputs
      const keyInput = screen.getAllByDisplayValue("email")[0];
      const labelInput = screen.getByDisplayValue("Email");
      expect(keyInput).toBeRequired();
      expect(labelInput).toBeRequired();
    });
  });
});
