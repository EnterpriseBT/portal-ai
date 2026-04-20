import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { FileUploadRegionDrawingStepUI } from "../FileUploadRegionDrawingStep.component";
import type { FileUploadRegionDrawingStepUIProps } from "../FileUploadRegionDrawingStep.component";
import {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
  SAMPLE_REGIONS,
} from "../utils/file-upload-fixtures.util";
import type { RegionDraft } from "../../../modules/RegionEditor";

function makeProps(
  overrides: Partial<FileUploadRegionDrawingStepUIProps> = {}
): FileUploadRegionDrawingStepUIProps {
  return {
    workbook: DEMO_WORKBOOK,
    regions: [],
    activeSheetId: DEMO_WORKBOOK.sheets[0].id,
    onActiveSheetChange: jest.fn(),
    selectedRegionId: null,
    onSelectRegion: jest.fn(),
    onRegionDraft: jest.fn(),
    onRegionUpdate: jest.fn(),
    onRegionDelete: jest.fn(),
    entityOptions: ENTITY_OPTIONS,
    onInterpret: jest.fn(),
    serverError: null,
    ...overrides,
  };
}

describe("FileUploadRegionDrawingStepUI — rendering", () => {
  test("renders the inner RegionDrawingStep header", () => {
    render(<FileUploadRegionDrawingStepUI {...makeProps()} />);
    expect(screen.getByText("Draw regions")).toBeInTheDocument();
  });

  test("renders a tab per workbook sheet", () => {
    render(<FileUploadRegionDrawingStepUI {...makeProps()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(DEMO_WORKBOOK.sheets.length);
    for (const sheet of DEMO_WORKBOOK.sheets) {
      expect(tabs.some((t) => t.textContent?.includes(sheet.name))).toBe(true);
    }
  });

  test("renders the Interpret button disabled when there are no regions", () => {
    render(<FileUploadRegionDrawingStepUI {...makeProps()} />);
    const btn = screen.getByRole("button", { name: /^interpret$/i });
    expect(btn).toBeDisabled();
  });
});

describe("FileUploadRegionDrawingStepUI — Interpret", () => {
  test("Interpret is enabled and fires onInterpret with a valid region", async () => {
    const user = userEvent.setup();
    const onInterpret = jest.fn();
    const region = SAMPLE_REGIONS[0];
    render(
      <FileUploadRegionDrawingStepUI
        {...makeProps({
          regions: [region],
          activeSheetId: region.sheetId,
          selectedRegionId: region.id,
          onInterpret,
        })}
      />
    );
    const btn = screen.getByRole("button", { name: /^interpret$/i });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(onInterpret).toHaveBeenCalledTimes(1);
  });

  test("Interpret label and disabled state flip while interpreting", () => {
    const region = SAMPLE_REGIONS[0];
    render(
      <FileUploadRegionDrawingStepUI
        {...makeProps({
          regions: [region],
          activeSheetId: region.sheetId,
          selectedRegionId: region.id,
          isInterpreting: true,
        })}
      />
    );
    const btn = screen.getByRole("button", { name: /interpreting/i });
    expect(btn).toBeDisabled();
  });

  test("blocks onInterpret when an invalid region exists and surfaces the invalid banner", async () => {
    const user = userEvent.setup();
    const onInterpret = jest.fn();
    const invalid: RegionDraft = {
      id: "r_invalid",
      sheetId: DEMO_WORKBOOK.sheets[0].id,
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 2 },
      orientation: "rows-as-records",
      headerAxis: "row",
      targetEntityDefinitionId: null,
    };
    render(
      <FileUploadRegionDrawingStepUI
        {...makeProps({
          regions: [invalid],
          activeSheetId: invalid.sheetId,
          selectedRegionId: invalid.id,
          onInterpret,
        })}
      />
    );
    const btn = screen.getByRole("button", { name: /^interpret$/i });
    await user.click(btn);
    expect(onInterpret).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/validation errors/i);
  });
});

describe("FileUploadRegionDrawingStepUI — server error", () => {
  test("renders FormAlert when serverError is provided", () => {
    render(
      <FileUploadRegionDrawingStepUI
        {...makeProps({
          serverError: {
            message: "Interpreter unavailable — try again shortly.",
            code: "INTERPRETER_UNAVAILABLE",
          },
        })}
      />
    );
    const alerts = screen.getAllByRole("alert");
    const formAlert = alerts.find((el) =>
      el.textContent?.includes("Interpreter unavailable")
    );
    expect(formAlert).toBeTruthy();
    expect(formAlert).toHaveTextContent("INTERPRETER_UNAVAILABLE");
  });

  test("does not render FormAlert when serverError is null", () => {
    render(<FileUploadRegionDrawingStepUI {...makeProps()} />);
    // No regions drawn, so no invalid-region banner. No server error. No alerts.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("FileUploadRegionDrawingStepUI — passthrough", () => {
  test("forwards onActiveSheetChange when user switches sheets", async () => {
    const user = userEvent.setup();
    const onActiveSheetChange = jest.fn();
    render(
      <FileUploadRegionDrawingStepUI {...makeProps({ onActiveSheetChange })} />
    );
    const secondSheet = DEMO_WORKBOOK.sheets[1];
    const tab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.includes(secondSheet.name))!;
    await user.click(tab);
    expect(onActiveSheetChange).toHaveBeenCalledWith(secondSheet.id);
  });

  test("forwards errors prop into the inner step (per-region error surfaces on attempted Interpret)", async () => {
    const user = userEvent.setup();
    const region = SAMPLE_REGIONS[0];
    render(
      <FileUploadRegionDrawingStepUI
        {...makeProps({
          regions: [region],
          activeSheetId: region.sheetId,
          selectedRegionId: region.id,
          errors: {
            [region.id]: { "bounds.endRow": "Out of sheet range (injected)" },
          },
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: /^interpret$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/validation errors/i);
  });
});
