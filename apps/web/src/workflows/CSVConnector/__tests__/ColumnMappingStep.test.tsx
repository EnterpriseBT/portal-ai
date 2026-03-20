import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnMappingStep } from "../ColumnMappingStep.component";
import type {
  RecommendedColumn,
  RecommendedEntity,
} from "../utils/upload-workflow.util";

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
    required: true,
    format: "email",
    enumValues: null,
    description: "Contact email",
  },
  sourceField: "Email Address",
  isPrimaryKeyCandidate: true,
  sampleValues: ["alice@example.com", "bob@test.org", "carol@acme.io"],
};

const MOCK_COLUMN_MED: RecommendedColumn = {
  action: "match_existing",
  confidence: 0.65,
  existingColumnDefinitionId: "col_002",
  recommended: {
    key: "name",
    label: "Name",
    type: "string",
    required: false,
    format: null,
    enumValues: null,
    description: null,
  },
  sourceField: "Full Name",
  isPrimaryKeyCandidate: false,
  sampleValues: ["Alice Smith", "Bob Jones"],
};

const MOCK_COLUMN_LOW: RecommendedColumn = {
  action: "create_new",
  confidence: 0.3,
  existingColumnDefinitionId: null,
  recommended: {
    key: "phone",
    label: "Phone",
    type: "string",
    required: false,
    format: null,
    enumValues: null,
    description: null,
  },
  sourceField: "Phone Number",
  isPrimaryKeyCandidate: false,
  sampleValues: ["+1-555-0100", "+1-555-0101"],
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
      render(<ColumnMappingStep entities={[]} onUpdateColumn={jest.fn()} />);
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
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByDisplayValue("email")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Email")).toBeInTheDocument();
      expect(screen.getByDisplayValue("phone")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Phone")).toBeInTheDocument();
    });

    it("displays type as an enabled select", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
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
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByText("2 columns")).toBeInTheDocument();
    });

    it("displays sample values", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
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
          onUpdateColumn={jest.fn()}
        />
      );
      expect(screen.getByText("Match")).toBeInTheDocument();
    });

    it("shows New label for create_new action", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
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
          onUpdateColumn={onUpdateColumn}
        />
      );

      const keyInput = screen.getByDisplayValue("email");
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
          onUpdateColumn={onUpdateColumn}
        />
      );

      // Open the first type select (for MOCK_COLUMN_HIGH)
      const typeSelects = screen.getAllByRole("combobox", { name: /type/i });
      await user.click(typeSelects[0]);
      await user.click(screen.getByRole("option", { name: "Currency" }));

      expect(onUpdateColumn).toHaveBeenCalledWith(
        0,
        0,
        expect.objectContaining({
          recommended: expect.objectContaining({ type: "currency" }),
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
        required: false,
        format: null,
        enumValues: null,
        description: null,
        refEntityKey: null,
        refColumnKey: null,
      },
      sourceField: "role_id",
      isPrimaryKeyCandidate: false,
      sampleValues: ["1", "2"],
    };

    it("shows reference entity and column selects when type is reference", () => {
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [refColumn] }]}
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
        required: false,
        format: null,
        enumValues: ["active", "inactive"],
        description: null,
      },
      sourceField: "Status",
      isPrimaryKeyCandidate: false,
      sampleValues: ["active", "inactive"],
    };

    it("shows enum values input when type is enum", () => {
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [enumColumn] }]}
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
          onUpdateColumn={jest.fn()}
        />
      );

      expect(screen.queryByLabelText(/enum values/i)).not.toBeInTheDocument();
    });

    it("displays existing enum values as comma-separated string", () => {
      render(
        <ColumnMappingStep
          entities={[{ ...MOCK_ENTITY_A, columns: [enumColumn] }]}
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
          onUpdateColumn={onUpdateColumn}
        />
      );

      const enumInput = screen.getByLabelText(/enum values/i);
      fireEvent.change(enumInput, { target: { value: "a, b, c" } });

      expect(onUpdateColumn).toHaveBeenLastCalledWith(
        0,
        0,
        expect.objectContaining({
          recommended: expect.objectContaining({
            enumValues: ["a", "b", "c"],
          }),
        })
      );
    });
  });
});
