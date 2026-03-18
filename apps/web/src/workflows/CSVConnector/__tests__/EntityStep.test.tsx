import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { EntityStep } from "../EntityStep.component";
import type {
  RecommendedColumn,
  RecommendedEntity,
  ParseSummary,
} from "../utils/upload-workflow.util";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_COLUMN: RecommendedColumn = {
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
  sampleValues: ["alice@example.com", "bob@test.org"],
};

const MOCK_COLUMN_NEW: RecommendedColumn = {
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
  sampleValues: ["+1-555-0100"],
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
});
