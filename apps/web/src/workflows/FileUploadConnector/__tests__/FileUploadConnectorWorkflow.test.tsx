import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { FileUploadConnectorWorkflowUI } from "../FileUploadConnectorWorkflow.component";
import type { FileUploadConnectorWorkflowUIProps } from "../FileUploadConnectorWorkflow.component";
import {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
  SAMPLE_FILE,
  SAMPLE_REGIONS,
  POST_INTERPRET_REGIONS,
} from "../utils/file-upload-fixtures.util";
import { FILE_UPLOAD_WORKFLOW_STEPS } from "../utils/file-upload-workflow.util";
import type { FileUploadProgress } from "../utils/file-upload-workflow.util";

function makeProps(
  overrides: Partial<FileUploadConnectorWorkflowUIProps> = {}
): FileUploadConnectorWorkflowUIProps {
  return {
    open: true,
    onClose: jest.fn(),
    step: 0,
    stepConfigs: FILE_UPLOAD_WORKFLOW_STEPS,

    files: [],
    onFilesChange: jest.fn(),
    uploadPhase: "idle",
    fileProgress: new Map<string, FileUploadProgress>(),
    overallUploadPercent: 0,
    onStartParse: jest.fn(),

    workbook: null,
    regions: [],
    selectedRegionId: null,
    activeSheetId: null,
    entityOptions: ENTITY_OPTIONS,
    onActiveSheetChange: jest.fn(),
    onSelectRegion: jest.fn(),
    onRegionDraft: jest.fn(),
    onRegionUpdate: jest.fn(),
    onRegionResize: jest.fn(),
    onRegionDelete: jest.fn(),
    onInterpret: jest.fn(),

    overallConfidence: undefined,
    onJumpToRegion: jest.fn(),
    onEditBinding: jest.fn(),
    onCommit: jest.fn(),

    onBack: jest.fn(),

    serverError: null,
    isInterpreting: false,
    isCommitting: false,
    ...overrides,
  };
}

describe("FileUploadConnectorWorkflowUI — modal shell", () => {
  test("renders the modal with its title when open", () => {
    render(<FileUploadConnectorWorkflowUI {...makeProps()} />);
    expect(screen.getByText("Upload a spreadsheet")).toBeInTheDocument();
  });

  test("does not render modal content when closed", () => {
    render(<FileUploadConnectorWorkflowUI {...makeProps({ open: false })} />);
    expect(screen.queryByText("Upload a spreadsheet")).not.toBeInTheDocument();
  });

  test("renders every step label in the stepper", () => {
    render(<FileUploadConnectorWorkflowUI {...makeProps()} />);
    for (const config of FILE_UPLOAD_WORKFLOW_STEPS) {
      // Some labels (e.g. "Draw regions") are reused as an inner heading when
      // the step is active, so tolerate multiple matches.
      expect(screen.getAllByText(config.label).length).toBeGreaterThan(0);
    }
  });
});

describe("FileUploadConnectorWorkflowUI — step routing", () => {
  test("step 0 renders the UploadStep dropzone", () => {
    render(<FileUploadConnectorWorkflowUI {...makeProps()} />);
    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
  });

  test("step 1 renders the Draw regions heading when a workbook is present", () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 1,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
        })}
      />
    );
    // "Draw regions" appears twice when step 1 is active — stepper label +
    // inner panel heading. Both rendered ⇒ the region-drawing panel is live.
    expect(screen.getAllByText("Draw regions").length).toBeGreaterThanOrEqual(
      2
    );
  });

  test("step 1 shows a loading fallback when the workbook is not yet populated", () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 1,
          workbook: null,
          uploadPhase: "parsing",
        })}
      />
    );
    expect(screen.getByText(/preparing your spreadsheet/i)).toBeInTheDocument();
  });

  test("step 2 renders the Review interpretation heading", () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 2,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          regions: POST_INTERPRET_REGIONS,
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
          overallConfidence: 0.85,
        })}
      />
    );
    expect(screen.getByText("Review interpretation")).toBeInTheDocument();
  });
});

describe("FileUploadConnectorWorkflowUI — footer navigation", () => {
  test("step 0 Cancel button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<FileUploadConnectorWorkflowUI {...makeProps({ onClose })} />);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("step 0 Upload button fires onStartParse and is disabled with no files", async () => {
    const user = userEvent.setup();
    const onStartParse = jest.fn();
    const { rerender } = render(
      <FileUploadConnectorWorkflowUI {...makeProps({ onStartParse })} />
    );
    const uploadBtn = screen.getByRole("button", { name: /^upload$/i });
    expect(uploadBtn).toBeDisabled();

    rerender(
      <FileUploadConnectorWorkflowUI
        {...makeProps({ onStartParse, files: [SAMPLE_FILE] })}
      />
    );
    await user.click(screen.getByRole("button", { name: /^upload$/i }));
    expect(onStartParse).toHaveBeenCalledTimes(1);
  });

  test("step 0 Upload button is disabled while uploading", () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          files: [SAMPLE_FILE],
          uploadPhase: "uploading",
        })}
      />
    );
    expect(screen.getByRole("button", { name: /^upload$/i })).toBeDisabled();
  });

  test("step 1 Back button calls onBack", async () => {
    const user = userEvent.setup();
    const onBack = jest.fn();
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 1,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
          onBack,
        })}
      />
    );
    const backButtons = screen
      .getAllByRole("button")
      .filter((b) => b.textContent?.trim() === "Back");
    expect(backButtons.length).toBeGreaterThan(0);
    await user.click(backButtons[0]);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("step 2 renders no global footer nav (Review step owns its own actions)", () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 2,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          regions: POST_INTERPRET_REGIONS,
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
        })}
      />
    );
    // The only Back available is the Review step's internal "Back to regions".
    expect(
      screen.queryByRole("button", { name: /^back$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /back to regions/i })
    ).toBeInTheDocument();
  });
});

describe("FileUploadConnectorWorkflowUI — server error", () => {
  test("propagates serverError into the active step's wrapper (step 0)", () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          serverError: {
            message: "Upload rejected by server",
            code: "UPLOAD_ERROR",
          },
        })}
      />
    );
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((el) => el.textContent?.includes("Upload rejected by server"))
    ).toBe(true);
  });

  test("propagates serverError into the active step's wrapper (step 1)", () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 1,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          files: [SAMPLE_FILE],
          regions: [SAMPLE_REGIONS[0]],
          selectedRegionId: SAMPLE_REGIONS[0].id,
          uploadPhase: "parsed",
          serverError: {
            message: "Interpreter unavailable",
            code: "INTERPRETER_UNAVAILABLE",
          },
        })}
      />
    );
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((el) => el.textContent?.includes("Interpreter unavailable"))
    ).toBe(true);
  });

  test("propagates serverError into the active step's wrapper (step 2)", () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 2,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          regions: POST_INTERPRET_REGIONS,
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
          serverError: {
            message: "Commit failed",
            code: "COMMIT_FAILED",
          },
        })}
      />
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("Commit failed"))).toBe(
      true
    );
  });
});

describe("FileUploadConnectorWorkflowUI — pending flags", () => {
  test('step 1 Interpret button label flips to "Interpreting…" when isInterpreting is true', () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 1,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          files: [SAMPLE_FILE],
          regions: [SAMPLE_REGIONS[0]],
          selectedRegionId: SAMPLE_REGIONS[0].id,
          uploadPhase: "parsed",
          isInterpreting: true,
        })}
      />
    );
    expect(
      screen.getByRole("button", { name: /interpreting/i })
    ).toBeDisabled();
  });

  test('step 2 Commit button label flips to "Committing…" when isCommitting is true', () => {
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 2,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          regions: POST_INTERPRET_REGIONS,
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
          isCommitting: true,
        })}
      />
    );
    expect(screen.getByRole("button", { name: /committing/i })).toBeDisabled();
  });
});

describe("FileUploadConnectorWorkflowUI — binding editor wiring", () => {
  // Local region fixture with canonical locator format ("header:X") so the
  // binding editor popover can parse it correctly. The POST_INTERPRET_REGIONS
  // fixture predates the popover and uses a legacy locator shape.
  const reviewableRegion = {
    id: "region-a",
    sheetId: DEMO_WORKBOOK.sheets[0].id,
    bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
    orientation: "rows-as-records" as const,
    headerAxis: "row" as const,
    targetEntityDefinitionId: "ent_contact",
    targetEntityLabel: "Contacts",
    confidence: 0.85,
    columnBindings: [
      {
        sourceLocator: "header:Email",
        columnDefinitionId: "coldef_email",
        columnDefinitionLabel: "Email",
        columnDefinitionType: "string" as const,
        confidence: 0.9,
      },
    ],
    warnings: [],
  };

  function searchStub() {
    return {
      onSearch: jest.fn(async () => []),
      onSearchPending: false,
      onSearchError: null,
      getById: jest.fn(async () => null),
      getByIdPending: false,
      getByIdError: null,
      labelMap: {},
    };
  }

  test("clicking a chip opens the popover (new wiring, popover-enabled path)", async () => {
    const user = userEvent.setup();
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 2,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          regions: [reviewableRegion],
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
          onUpdateBinding: jest.fn(),
          onToggleBindingExcluded: jest.fn(),
          columnDefinitionSearch: searchStub(),
        })}
      />
    );
    const chip = screen.getByRole("button", {
      name: /edit binding.*header:email/i,
    });
    await user.click(chip);
    expect(
      document.querySelector('form[aria-label="Edit column binding"]')
    ).not.toBeNull();
  });

  test("Apply in the popover fires onUpdateBinding with the normalizedKey patch", async () => {
    const user = userEvent.setup();
    const onUpdateBinding = jest.fn();
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 2,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          regions: [reviewableRegion],
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
          onUpdateBinding,
          onToggleBindingExcluded: jest.fn(),
          columnDefinitionSearch: searchStub(),
        })}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    const normalizedKey = screen.getByLabelText(
      /normalized key/i
    ) as HTMLInputElement;
    await user.clear(normalizedKey);
    await user.type(normalizedKey, "email_override");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onUpdateBinding).toHaveBeenCalledWith(
      "region-a",
      "header:Email",
      expect.objectContaining({ normalizedKey: "email_override" })
    );
  });

  test("falls back to onEditBinding when popover deps are missing (legacy consumers)", async () => {
    const user = userEvent.setup();
    const onEditBinding = jest.fn();
    render(
      <FileUploadConnectorWorkflowUI
        {...makeProps({
          step: 2,
          workbook: DEMO_WORKBOOK,
          activeSheetId: DEMO_WORKBOOK.sheets[0].id,
          regions: [reviewableRegion],
          files: [SAMPLE_FILE],
          uploadPhase: "parsed",
          onEditBinding,
          // onUpdateBinding / columnDefinitionSearch omitted — legacy path.
        })}
      />
    );
    await user.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    expect(onEditBinding).toHaveBeenCalledWith("region-a", "header:Email");
    expect(
      document.querySelector('form[aria-label="Edit column binding"]')
    ).toBeNull();
  });
});
