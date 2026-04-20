import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";
import userEvent from "@testing-library/user-event";

import { UploadStep } from "../UploadStep.component";
import type { UploadStepUIProps } from "../UploadStep.component";
import type { FileUploadProgress } from "../../../utils/file-upload.util";
import { SPREADSHEET_FILE_EXTENSIONS } from "../utils/file-upload-fixtures.util";

function makeProps(
  overrides: Partial<UploadStepUIProps> = {}
): UploadStepUIProps {
  return {
    files: [],
    onFilesChange: jest.fn(),
    uploadPhase: "idle",
    fileProgress: new Map<string, FileUploadProgress>(),
    overallUploadPercent: 0,
    serverError: null,
    ...overrides,
  };
}

const SAMPLE_A = new File(["a,b,c"], "contacts.csv", { type: "text/csv" });
const SAMPLE_B = new File(["x,y"], "products.xlsx", {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

describe("UploadStep — drop zone", () => {
  test("renders the drop zone with the spreadsheet accept list", () => {
    render(<UploadStep {...makeProps()} />);
    const dropzone = screen.getByTestId("dropzone");
    expect(dropzone).toBeInTheDocument();
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    for (const ext of SPREADSHEET_FILE_EXTENSIONS) {
      expect(input.getAttribute("accept")).toContain(ext);
    }
  });

  test("shows the empty-state prompt when no files are selected", () => {
    render(<UploadStep {...makeProps()} />);
    expect(screen.getByText(/select.*spreadsheet/i)).toBeInTheDocument();
  });

  test("lists selected files with upload progress rows", () => {
    const fileProgress = new Map<string, FileUploadProgress>([
      [
        SAMPLE_A.name,
        { fileName: SAMPLE_A.name, loaded: 512, total: 1024, percent: 50 },
      ],
    ]);
    render(
      <UploadStep
        {...makeProps({
          files: [SAMPLE_A],
          uploadPhase: "uploading",
          fileProgress,
        })}
      />
    );
    expect(screen.getByText(SAMPLE_A.name)).toBeInTheDocument();
    const progressBars = document.querySelectorAll('[role="progressbar"]');
    expect(progressBars.length).toBeGreaterThan(0);
  });
});

describe("UploadStep — onFilesChange", () => {
  test("blocks duplicate filenames", async () => {
    const user = userEvent.setup();
    const onFilesChange = jest.fn();
    render(
      <UploadStep
        {...makeProps({
          files: [SAMPLE_A],
          onFilesChange,
        })}
      />
    );
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    // Try to select the same file again.
    await user.upload(input, SAMPLE_A);
    expect(onFilesChange).not.toHaveBeenCalled();
  });

  test("appends new unique filenames", async () => {
    const user = userEvent.setup();
    const onFilesChange = jest.fn();
    render(
      <UploadStep
        {...makeProps({
          files: [SAMPLE_A],
          onFilesChange,
        })}
      />
    );
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    await user.upload(input, SAMPLE_B);
    expect(onFilesChange).toHaveBeenCalledTimes(1);
    const next = onFilesChange.mock.calls[0][0] as File[];
    expect(next.map((f) => f.name)).toEqual([SAMPLE_A.name, SAMPLE_B.name]);
  });
});

describe("UploadStep — disabled states", () => {
  test('disables the drop zone while uploadPhase === "uploading"', () => {
    render(
      <UploadStep
        {...makeProps({
          files: [SAMPLE_A],
          uploadPhase: "uploading",
        })}
      />
    );
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  test('disables the drop zone while uploadPhase === "parsing"', () => {
    render(
      <UploadStep
        {...makeProps({
          files: [SAMPLE_A],
          uploadPhase: "parsing",
        })}
      />
    );
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  test('leaves the drop zone enabled while uploadPhase === "idle"', () => {
    render(<UploadStep {...makeProps()} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    expect(input).not.toBeDisabled();
  });
});

describe("UploadStep — server error", () => {
  test("renders FormAlert when serverError is set", () => {
    render(
      <UploadStep
        {...makeProps({
          serverError: {
            message: "Parse failed — unknown format",
            code: "UPLOAD_PARSE_ERROR",
          },
        })}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Parse failed — unknown format"
    );
    expect(screen.getByRole("alert")).toHaveTextContent("UPLOAD_PARSE_ERROR");
  });

  test("does not render FormAlert when serverError is null", () => {
    render(<UploadStep {...makeProps()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("UploadStep — validation errors", () => {
  test('sets aria-invalid="true" on the file input when errors.files is set', () => {
    render(
      <UploadStep
        {...makeProps({
          errors: { files: "Please select at least one file" },
        })}
      />
    );
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText("Please select at least one file")
    ).toBeInTheDocument();
  });

  test("does not set aria-invalid when errors.files is absent", () => {
    render(<UploadStep {...makeProps()} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });
});

describe("UploadStep — onRetry", () => {
  test("renders a Retry button when onRetry is provided and phase is error", async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    render(
      <UploadStep
        {...makeProps({
          files: [SAMPLE_A],
          uploadPhase: "error",
          onRetry,
          serverError: {
            message: "Network error",
            code: "NETWORK_ERROR",
          },
        })}
      />
    );
    const retry = screen.getByRole("button", { name: /retry/i });
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("does not render a Retry button when onRetry is omitted", () => {
    render(
      <UploadStep
        {...makeProps({
          files: [SAMPLE_A],
          uploadPhase: "error",
        })}
      />
    );
    expect(
      screen.queryByRole("button", { name: /retry/i })
    ).not.toBeInTheDocument();
  });
});
