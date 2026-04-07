import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { CSVConnectorWorkflowUI } from "../CSVConnectorWorkflow.component";
import type { CSVConnectorWorkflowUIProps } from "../CSVConnectorWorkflow.component";
import type {
  Recommendations,
  RecommendedColumn,
  RecommendedEntity,
} from "../utils/upload-workflow.util";
import type { FileUploadProgress } from "../../../utils/file-upload.util";
import type { EntityStepErrors, ColumnStepErrors } from "../utils/csv-validation.util";

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
    description: "Contact email",
  },
  sourceField: "Email Address",
  isPrimaryKeyCandidate: true,
  sampleValues: ["alice@example.com", "bob@test.org", "carol@acme.io"],
  required: true,
  format: "email",
  enumValues: null,
};

const MOCK_COLUMN_NEW: RecommendedColumn = {
  action: "create_new",
  confidence: 0.45,
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

const MOCK_ENTITIES: RecommendedEntity[] = [
  {
    connectorEntity: { key: "contacts", label: "Contacts" },
    sourceFileName: "contacts.csv",
    columns: [MOCK_COLUMN, MOCK_COLUMN_NEW],
  },
];

const MOCK_RECOMMENDATIONS: Recommendations = {
  connectorInstance: { name: "My CSV Import", config: {} },
  entities: MOCK_ENTITIES,
};

const STEP_CONFIGS = [
  { label: "Upload CSV", description: "Select and upload CSV files" },
  { label: "Confirm Entities", description: "Review detected entities" },
  { label: "Map Columns", description: "Map CSV columns to definitions" },
  { label: "Review & Import", description: "Review and confirm import" },
];

const MOCK_FILES = [
  new File(["a,b,c"], "contacts.csv", { type: "text/csv" }),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<CSVConnectorWorkflowUIProps> = {}
): CSVConnectorWorkflowUIProps {
  return {
    open: true,
    onClose: jest.fn(),
    step: 0,
    stepConfigs: STEP_CONFIGS,
    files: [],
    onFilesChange: jest.fn(),
    uploadPhase: "idle",
    fileProgress: new Map<string, FileUploadProgress>(),
    overallUploadPercent: 0,
    jobProgress: 0,
    jobError: null,
    uploadError: null,
    isProcessing: false,
    connectionStatus: "idle",
    jobStatus: null,
    jobResult: null,
    recommendations: null,
    parseResults: null,
    onUpdateEntity: jest.fn(),
    dbEntities: [],
    isLoadingDbEntities: false,
    onUpdateColumn: jest.fn(),
    onColumnKeySearch: jest.fn<() => Promise<{ value: string; label: string }[]>>().mockResolvedValue([]),
    columnDefsByKey: {},
    onConnectorNameChange: jest.fn(),
    onConfirm: jest.fn(),
    isConfirming: false,
    confirmError: null,
    confirmResult: null,
    onDone: jest.fn(),
    onCancel: jest.fn(),
    isCancelling: false,
    onBack: jest.fn(),
    onNext: jest.fn(),
    backLabel: "Cancel",
    nextLabel: "Upload",
    isBackDisabled: false,
    isNextDisabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CSVConnectorWorkflowUI", () => {
  describe("Modal shell", () => {
    it("renders modal with title when open", () => {
      render(<CSVConnectorWorkflowUI {...makeProps()} />);
      expect(screen.getByText("CSV File Upload")).toBeInTheDocument();
    });

    it("does not render content when closed", () => {
      render(<CSVConnectorWorkflowUI {...makeProps({ open: false })} />);
      expect(screen.queryByText("CSV File Upload")).not.toBeInTheDocument();
    });
  });

  describe("Navigation buttons", () => {
    it("renders back and next buttons with provided labels", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({ backLabel: "Cancel", nextLabel: "Upload" })}
        />
      );
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    });

    it("disables next button when isNextDisabled is true", () => {
      render(
        <CSVConnectorWorkflowUI {...makeProps({ isNextDisabled: true })} />
      );
      expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    });

    it("enables next button when isNextDisabled is false", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({ isNextDisabled: false, nextLabel: "Next" })}
        />
      );
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    });

    it("disables back button when isBackDisabled is true", () => {
      render(
        <CSVConnectorWorkflowUI {...makeProps({ isBackDisabled: true })} />
      );
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });

    it("calls onNext when next button clicked", async () => {
      const user = userEvent.setup();
      const onNext = jest.fn();
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({ onNext, isNextDisabled: false, nextLabel: "Next" })}
        />
      );
      await user.click(screen.getByRole("button", { name: "Next" }));
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("calls onBack when back button clicked", async () => {
      const user = userEvent.setup();
      const onBack = jest.fn();
      render(
        <CSVConnectorWorkflowUI {...makeProps({ onBack, backLabel: "Back" })} />
      );
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("Stepper", () => {
    it("renders all step labels", () => {
      render(<CSVConnectorWorkflowUI {...makeProps()} />);
      expect(screen.getByText("Upload CSV")).toBeInTheDocument();
      expect(screen.getByText("Confirm Entities")).toBeInTheDocument();
      expect(screen.getByText("Map Columns")).toBeInTheDocument();
      expect(screen.getByText("Review & Import")).toBeInTheDocument();
    });
  });

  describe("Step 0: Upload", () => {
    it("shows file picker text when idle", () => {
      render(<CSVConnectorWorkflowUI {...makeProps()} />);
      expect(
        screen.getByText("Select one or more CSV files to upload.")
      ).toBeInTheDocument();
    });

    it("shows upload error when present", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            uploadPhase: "error",
            uploadError: "S3 upload failed",
          })}
        />
      );
      expect(screen.getByText("S3 upload failed")).toBeInTheDocument();
    });

    it("shows processing label during presigning phase", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "presigning",
            isProcessing: true,
          })}
        />
      );
      expect(screen.getByText("Preparing upload...")).toBeInTheDocument();
    });

    it("shows per-file progress during upload phase", () => {
      const fileProgress = new Map<string, FileUploadProgress>();
      fileProgress.set("contacts.csv", {
        fileName: "contacts.csv",
        loaded: 500,
        total: 1000,
        percent: 50,
      });

      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "uploading",
            isProcessing: true,
            fileProgress,
          })}
        />
      );
      expect(screen.getByText("contacts.csv")).toBeInTheDocument();
      expect(
        screen.getByText("Uploading files to storage...")
      ).toBeInTheDocument();
    });
  });

  describe("Step 1: Confirm Entities", () => {
    it("shows waiting message when no recommendations", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({ step: 1, recommendations: null })}
        />
      );
      expect(
        screen.getByText("Waiting for recommendations...")
      ).toBeInTheDocument();
    });

    it("shows entity details when recommendations present", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 1,
            files: MOCK_FILES,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.getByText("2 columns detected")).toBeInTheDocument();
      expect(screen.getByDisplayValue("contacts")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Contacts")).toBeInTheDocument();
    });

    it("shows source file name for entity", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 1,
            files: MOCK_FILES,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.getByText("Source: contacts.csv")).toBeInTheDocument();
    });
  });

  describe("Step 2: Column Mapping", () => {
    it("shows waiting message when no recommendations", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({ step: 2, recommendations: null })}
        />
      );
      expect(
        screen.getByText("Waiting for recommendations...")
      ).toBeInTheDocument();
    });

    it("shows column details when recommendations present", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 2,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.getByText("Email Address")).toBeInTheDocument();
      expect(screen.getByText("Phone Number")).toBeInTheDocument();
      expect(screen.getByText("95%")).toBeInTheDocument();
      expect(screen.getByText("45%")).toBeInTheDocument();
    });

    it("shows Match label for match_existing action", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 2,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.getByText("Match")).toBeInTheDocument();
      expect(screen.getByText("New")).toBeInTheDocument();
    });
  });

  describe("Step 3: Review & Import", () => {
    it("shows no recommendations message when null", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({ step: 3, recommendations: null })}
        />
      );
      expect(
        screen.getByText("No recommendations available.")
      ).toBeInTheDocument();
    });

    it("shows connector instance name", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 3,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.getByDisplayValue("My CSV Import")).toBeInTheDocument();
    });

    it("shows summary statistics", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 3,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.getByText("Entities: 1")).toBeInTheDocument();
      expect(
        screen.getByText("Total columns: 2 (1 matched, 1 new)")
      ).toBeInTheDocument();
    });

    it("shows per-entity column mapping details", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 3,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.getByText("Contacts (contacts)")).toBeInTheDocument();
      expect(screen.getByText("email (string)")).toBeInTheDocument();
      expect(screen.getByText("phone (string)")).toBeInTheDocument();
    });

    it("calls onConnectorNameChange when name is edited", async () => {
      const user = userEvent.setup();
      const onConnectorNameChange = jest.fn();
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 3,
            recommendations: MOCK_RECOMMENDATIONS,
            onConnectorNameChange,
          })}
        />
      );
      const input = screen.getByDisplayValue("My CSV Import");
      await user.clear(input);
      await user.type(input, "Renamed");
      expect(onConnectorNameChange).toHaveBeenCalled();
    });
  });

  describe("Step 1: Entity validation errors", () => {
    it("displays entity key error when entityStepErrors is passed", () => {
      const entityStepErrors: EntityStepErrors = {
        0: { key: "Entity key is required" },
      };
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 1,
            files: MOCK_FILES,
            recommendations: MOCK_RECOMMENDATIONS,
            entityStepErrors,
          })}
        />
      );
      expect(screen.getByText("Entity key is required")).toBeInTheDocument();
    });

    it("displays entity label error when entityStepErrors is passed", () => {
      const entityStepErrors: EntityStepErrors = {
        0: { label: "Entity label is required" },
      };
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 1,
            files: MOCK_FILES,
            recommendations: MOCK_RECOMMENDATIONS,
            entityStepErrors,
          })}
        />
      );
      expect(screen.getByText("Entity label is required")).toBeInTheDocument();
    });

    it("does not display entity errors when entityStepErrors is undefined", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 1,
            files: MOCK_FILES,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.queryByText("Entity key is required")).not.toBeInTheDocument();
    });
  });

  describe("Step 2: Column validation errors", () => {
    it("displays column key error when columnStepErrors is passed", () => {
      const columnStepErrors: ColumnStepErrors = {
        0: { 0: { key: "Column key is required" } },
      };
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 2,
            recommendations: MOCK_RECOMMENDATIONS,
            columnStepErrors,
          })}
        />
      );
      expect(screen.getByText("Column key is required")).toBeInTheDocument();
    });

    it("displays column type error when columnStepErrors is passed", () => {
      const columnStepErrors: ColumnStepErrors = {
        0: { 0: { type: "Column type is required" } },
      };
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 2,
            recommendations: MOCK_RECOMMENDATIONS,
            columnStepErrors,
          })}
        />
      );
      expect(screen.getByText("Column type is required")).toBeInTheDocument();
    });

    it("does not display column errors when columnStepErrors is undefined", () => {
      render(
        <CSVConnectorWorkflowUI
          {...makeProps({
            step: 2,
            recommendations: MOCK_RECOMMENDATIONS,
          })}
        />
      );
      expect(screen.queryByText("Column key is required")).not.toBeInTheDocument();
    });
  });
});
