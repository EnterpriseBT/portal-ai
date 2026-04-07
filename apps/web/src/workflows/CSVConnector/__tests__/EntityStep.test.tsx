import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { EntityStep } from "../EntityStep.component";
import type {
  RecommendedColumn,
  RecommendedEntity,
  ParseSummary,
} from "../utils/upload-workflow.util";
import type { EntityStepErrors } from "../utils/csv-validation.util";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_COLUMN: RecommendedColumn = {
  confidence: 0.95,
  existingColumnDefinitionId: "col_001",
  existingColumnDefinitionKey: "email",
  sourceField: "Email Address",
  isPrimaryKeyCandidate: true,
  sampleValues: ["alice@example.com", "bob@test.org"],
  normalizedKey: "email_address",
  required: true,
  format: "email",
  enumValues: null,
  defaultValue: null,
};

const MOCK_COLUMN_NEW: RecommendedColumn = {
  confidence: 0.3,
  existingColumnDefinitionId: "col_002",
  existingColumnDefinitionKey: "phone",
  sourceField: "Phone Number",
  isPrimaryKeyCandidate: false,
  sampleValues: ["+1-555-0100"],
  normalizedKey: "phone_number",
  required: false,
  format: null,
  enumValues: null,
  defaultValue: null,
};

const MOCK_ENTITIES: RecommendedEntity[] = [
  {
    connectorEntity: { key: "contacts", label: "Contacts" },
    sourceFileName: "contacts.csv",
    columns: [MOCK_COLUMN, MOCK_COLUMN_NEW],
  },
];

const MOCK_PARSE_RESULTS: ParseSummary[] = [
  {
    fileName: "contacts.csv",
    rowCount: 1500,
    delimiter: ",",
    encoding: "utf-8",
    columnCount: 3,
  },
];

const MOCK_FILES = [
  new File(["a,b,c"], "contacts.csv", { type: "text/csv" }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EntityStep", () => {
  describe("Empty state", () => {
    it("shows no-entities message when entities array is empty", () => {
      render(
        <EntityStep
          entities={[]}
          files={[]}
          parseResults={null}
          onUpdateEntity={jest.fn()}
        />
      );
      expect(
        screen.getByText("No entities detected. Please go back and upload files.")
      ).toBeInTheDocument();
    });
  });

  describe("Entity list rendering", () => {
    it("renders entity cards from recommendations", () => {
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
        />
      );
      expect(screen.getByDisplayValue("contacts")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Contacts")).toBeInTheDocument();
    });

    it("displays source file name as read-only text", () => {
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
        />
      );
      expect(screen.getByText("Source: contacts.csv")).toBeInTheDocument();
    });

    it("displays column count for each entity", () => {
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
        />
      );
      expect(screen.getByText("2 columns detected")).toBeInTheDocument();
    });

    it("renders multiple entities", () => {
      const multiEntities: RecommendedEntity[] = [
        ...MOCK_ENTITIES,
        {
          connectorEntity: { key: "products", label: "Products" },
          sourceFileName: "products.csv",
          columns: [MOCK_COLUMN],
        },
      ];
      render(
        <EntityStep
          entities={multiEntities}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
        />
      );
      expect(screen.getByDisplayValue("contacts")).toBeInTheDocument();
      expect(screen.getByDisplayValue("products")).toBeInTheDocument();
    });
  });

  describe("Parse summary", () => {
    it("shows parse summary when parse results are provided", () => {
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={MOCK_PARSE_RESULTS}
          onUpdateEntity={jest.fn()}
        />
      );
      expect(screen.getByText("Parse Summary")).toBeInTheDocument();
    });

    it("displays row count and delimiter for each parsed file", () => {
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={MOCK_PARSE_RESULTS}
          onUpdateEntity={jest.fn()}
        />
      );
      expect(
        screen.getByText((content) => content.includes("1,500 rows") && content.includes("delimiter"))
      ).toBeInTheDocument();
    });

    it("does not show parse summary when parseResults is null", () => {
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
        />
      );
      expect(screen.queryByText("Parse Summary")).not.toBeInTheDocument();
    });
  });

  describe("Entity editing", () => {
    it("entity key field is editable", async () => {
      const user = userEvent.setup();
      const onUpdateEntity = jest.fn();

      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={onUpdateEntity}
        />
      );

      const keyInput = screen.getByDisplayValue("contacts");
      await user.clear(keyInput);
      await user.type(keyInput, "people");

      expect(onUpdateEntity).toHaveBeenCalled();
    });

    it("entity label field is editable", async () => {
      const user = userEvent.setup();
      const onUpdateEntity = jest.fn();

      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={onUpdateEntity}
        />
      );

      const labelInput = screen.getByDisplayValue("Contacts");
      await user.clear(labelInput);
      await user.type(labelInput, "People");

      expect(onUpdateEntity).toHaveBeenCalled();
    });

    it("onUpdateEntity fires with correct index when key changes", async () => {
      const user = userEvent.setup();
      const onUpdateEntity = jest.fn();

      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={onUpdateEntity}
        />
      );

      const keyInput = screen.getByDisplayValue("contacts");
      await user.clear(keyInput);
      await user.type(keyInput, "x");

      // First call should be for index 0 (the clear triggers onChange too)
      expect(onUpdateEntity).toHaveBeenCalledWith(
        0,
        expect.objectContaining({
          connectorEntity: expect.objectContaining({ key: expect.any(String) }),
        })
      );
    });

    it("onUpdateEntity fires with correct index when label changes", async () => {
      const user = userEvent.setup();
      const onUpdateEntity = jest.fn();

      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={onUpdateEntity}
        />
      );

      const labelInput = screen.getByDisplayValue("Contacts");
      await user.clear(labelInput);
      await user.type(labelInput, "x");

      expect(onUpdateEntity).toHaveBeenCalledWith(
        0,
        expect.objectContaining({
          connectorEntity: expect.objectContaining({ label: expect.any(String) }),
        })
      );
    });
  });

  describe("Validation errors", () => {
    it("displays key error when errors prop has key error for entity", () => {
      const errors: EntityStepErrors = {
        0: { key: "Entity key is required" },
      };
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
          errors={errors}
        />
      );
      expect(screen.getByText("Entity key is required")).toBeInTheDocument();
    });

    it("displays label error when errors prop has label error for entity", () => {
      const errors: EntityStepErrors = {
        0: { label: "Entity label is required" },
      };
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
          errors={errors}
        />
      );
      expect(screen.getByText("Entity label is required")).toBeInTheDocument();
    });

    it("does not display errors for entities without errors", () => {
      const multiEntities: RecommendedEntity[] = [
        ...MOCK_ENTITIES,
        {
          connectorEntity: { key: "products", label: "Products" },
          sourceFileName: "products.csv",
          columns: [MOCK_COLUMN],
        },
      ];
      const errors: EntityStepErrors = {
        1: { key: "Entity key is required" },
      };
      render(
        <EntityStep
          entities={multiEntities}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
          errors={errors}
        />
      );
      // Only one error message should appear (for entity index 1)
      const errorTexts = screen.getAllByText("Entity key is required");
      expect(errorTexts).toHaveLength(1);
    });

    it("does not display errors when errors prop is empty", () => {
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
          errors={{}}
        />
      );
      expect(screen.queryByText("Entity key is required")).not.toBeInTheDocument();
      expect(screen.queryByText("Entity label is required")).not.toBeInTheDocument();
    });

    it("marks entity key and label fields as required", () => {
      render(
        <EntityStep
          entities={MOCK_ENTITIES}
          files={MOCK_FILES}
          parseResults={null}
          onUpdateEntity={jest.fn()}
        />
      );
      const keyInput = screen.getByDisplayValue("contacts");
      const labelInput = screen.getByDisplayValue("Contacts");
      expect(keyInput).toBeRequired();
      expect(labelInput).toBeRequired();
    });
  });
});
