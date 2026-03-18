import { jest } from "@jest/globals";

import { render, screen, within } from "../../../__tests__/test-utils";
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
      render(
        <ColumnMappingStep entities={[]} onUpdateColumn={jest.fn()} />
      );
      expect(
        screen.getByText("No entities available. Please go back and review entities.")
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

    it("displays type field as disabled", () => {
      render(
        <ColumnMappingStep
          entities={[MOCK_ENTITY_A]}
          onUpdateColumn={jest.fn()}
        />
      );
      const typeInputs = screen.getAllByDisplayValue("string");
      for (const input of typeInputs) {
        expect(input).toBeDisabled();
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
      expect(
        screen.getByText(/alice@example\.com/)
      ).toBeInTheDocument();
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
  });
});
