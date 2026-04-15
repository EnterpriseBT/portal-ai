import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";

import type { JobStatus } from "@portalai/core/models";

import { UploadStep } from "../UploadStep.component";
import type { FileUploadProgress, UploadPhase } from "../../../utils/file-upload.util";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UploadStepTestProps {
  files?: File[];
  onFilesChange?: jest.Mock;
  uploadPhase?: UploadPhase;
  fileProgress?: Map<string, FileUploadProgress>;
  overallUploadPercent?: number;
  jobProgress?: number;
  jobError?: string | null;
  uploadError?: string | null;
  isProcessing?: boolean;
  connectionStatus?: string;
  jobStatus?: JobStatus | null;
  jobResult?: Record<string, unknown> | null;
}

function makeProps(overrides: UploadStepTestProps = {}) {
  return {
    files: [] as File[],
    onFilesChange: jest.fn(),
    uploadPhase: "idle" as UploadPhase,
    fileProgress: new Map<string, FileUploadProgress>(),
    overallUploadPercent: 0,
    jobProgress: 0,
    jobError: null,
    uploadError: null,
    isProcessing: false,
    connectionStatus: "idle",
    jobStatus: null,
    jobResult: null,
    ...overrides,
  };
}

const MOCK_FILES = [
  new File(["a,b,c\n1,2,3"], "contacts.csv", { type: "text/csv" }),
  new File(["x,y\n4,5"], "products.csv", { type: "text/csv" }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UploadStep", () => {
  describe("Idle state — file picker", () => {
    it("renders file picker prompt when phase is idle", () => {
      render(<UploadStep {...makeProps()} />);
      expect(
        screen.getByText("Select one or more files to upload.")
      ).toBeInTheDocument();
    });

    it("renders FileUploader with .csv,.xlsx accept attribute", () => {
      render(<UploadStep {...makeProps()} />);
      expect(
        screen.getByText(/Accepted formats: \.csv, \.xlsx/)
      ).toBeInTheDocument();
    });

    it("renders sample file download links in idle state", () => {
      render(<UploadStep {...makeProps()} />);
      expect(
        screen.getByRole("link", { name: "sample-contacts.csv" })
      ).toHaveAttribute("href", "/samples/sample-contacts.csv");
      expect(
        screen.getByRole("link", { name: "sample-data.xlsx" })
      ).toHaveAttribute("href", "/samples/sample-data.xlsx");
    });

    it("shows file picker on error phase when not processing", () => {
      render(
        <UploadStep
          {...makeProps({ uploadPhase: "error", isProcessing: false })}
        />
      );
      expect(
        screen.getByText("Select one or more files to upload.")
      ).toBeInTheDocument();
    });

    it("shows upload error in idle/error state", () => {
      render(
        <UploadStep
          {...makeProps({
            uploadPhase: "error",
            uploadError: "Connection timeout",
          })}
        />
      );
      expect(screen.getByText("Connection timeout")).toBeInTheDocument();
    });

    it("shows job error in idle/error state", () => {
      render(
        <UploadStep
          {...makeProps({
            uploadPhase: "error",
            jobError: "Processing failed",
          })}
        />
      );
      expect(screen.getByText("Processing failed")).toBeInTheDocument();
    });
  });

  describe("Phase labels", () => {
    it('shows "Preparing upload..." during presigning phase', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "presigning",
            isProcessing: true,
          })}
        />
      );
      expect(screen.getByText("Preparing upload...")).toBeInTheDocument();
    });

    it('shows "Uploading files to storage..." during uploading phase', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "uploading",
            isProcessing: true,
          })}
        />
      );
      expect(
        screen.getByText("Uploading files to storage...")
      ).toBeInTheDocument();
    });

    it('shows "Starting processing..." during processing phase', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "processing",
            isProcessing: true,
          })}
        />
      );
      expect(screen.getByText("Starting processing...")).toBeInTheDocument();
    });

    it('shows "Verifying files..." when done with jobProgress <= 10', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            jobProgress: 5,
            isProcessing: true,
          })}
        />
      );
      expect(screen.getByText("Verifying files...")).toBeInTheDocument();
    });

    it('shows "Parsing files..." when done with jobProgress 11-29', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            jobProgress: 15,
            isProcessing: true,
          })}
        />
      );
      expect(screen.getByText("Parsing files...")).toBeInTheDocument();
    });

    it('shows "Analyzing schema..." when done with jobProgress 30-69', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            jobProgress: 50,
            isProcessing: true,
          })}
        />
      );
      expect(screen.getByText("Analyzing schema...")).toBeInTheDocument();
    });

    it('shows "Generating recommendations..." when done with jobProgress 70-79', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            jobProgress: 75,
            isProcessing: true,
          })}
        />
      );
      expect(
        screen.getByText("Generating recommendations...")
      ).toBeInTheDocument();
    });

    it('shows "Finalizing..." when done with jobProgress >= 80', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            jobProgress: 90,
            isProcessing: true,
          })}
        />
      );
      expect(screen.getByText("Finalizing...")).toBeInTheDocument();
    });

    it('shows "An error occurred" for error phase during processing', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "error",
            isProcessing: true,
          })}
        />
      );
      expect(screen.getByText("An error occurred")).toBeInTheDocument();
    });
  });

  describe("Per-file upload progress", () => {
    it("renders file name and progress for each file during upload phase", () => {
      const fileProgress = new Map<string, FileUploadProgress>();
      fileProgress.set("contacts.csv", {
        fileName: "contacts.csv",
        loaded: 500,
        total: 1000,
        percent: 50,
      });
      fileProgress.set("products.csv", {
        fileName: "products.csv",
        loaded: 200,
        total: 800,
        percent: 25,
      });

      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "uploading",
            isProcessing: true,
            fileProgress,
          })}
        />
      );

      expect(screen.getByText("contacts.csv")).toBeInTheDocument();
      expect(screen.getByText("products.csv")).toBeInTheDocument();
    });

    it("shows formatted byte sizes for file progress", () => {
      const fileProgress = new Map<string, FileUploadProgress>();
      fileProgress.set("contacts.csv", {
        fileName: "contacts.csv",
        loaded: 512,
        total: 1024,
        percent: 50,
      });

      // Create a file with a known size matching fileProgress total
      const file = new File(["x".repeat(1024)], "contacts.csv", { type: "text/csv" });

      render(
        <UploadStep
          {...makeProps({
            files: [file],
            uploadPhase: "uploading",
            isProcessing: true,
            fileProgress,
          })}
        />
      );

      // The component shows "{loaded} / {file.size}" via formatBytes
      // 512 B loaded, file.size = 1024 = 1 KB
      expect(screen.getByText((content) =>
        content.includes("512 B") && content.includes("1 KB")
      )).toBeInTheDocument();
    });

    it("does not render per-file progress for non-uploading phases", () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "processing",
            isProcessing: true,
          })}
        />
      );

      // File names should not appear as per-file progress rows
      expect(screen.queryByText("contacts.csv")).not.toBeInTheDocument();
    });
  });

  describe("Overall progress", () => {
    it("shows overall progress bar during processing phase", () => {
      const { container } = render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "processing",
            isProcessing: true,
            overallUploadPercent: 75,
          })}
        />
      );

      // Progress component should be rendered (not per-file)
      expect(screen.queryByText("contacts.csv")).not.toBeInTheDocument();
      // The overall progress bar should exist
      const progressBars = container.querySelectorAll('[role="progressbar"]');
      expect(progressBars.length).toBeGreaterThan(0);
    });

    it("shows job progress during done phase", () => {
      const { container } = render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            jobProgress: 45,
            isProcessing: true,
          })}
        />
      );

      const progressBars = container.querySelectorAll('[role="progressbar"]');
      expect(progressBars.length).toBeGreaterThan(0);
    });
  });

  describe("Connection status", () => {
    it('shows reconnecting warning when connectionStatus is "error"', () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            isProcessing: true,
            connectionStatus: "error",
          })}
        />
      );

      expect(
        screen.getByText("Connection lost. Reconnecting...")
      ).toBeInTheDocument();
    });

    it("does not show reconnecting warning when connected", () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            isProcessing: true,
            connectionStatus: "connected",
          })}
        />
      );

      expect(
        screen.queryByText("Connection lost. Reconnecting...")
      ).not.toBeInTheDocument();
    });
  });

  describe("Error display during active phase", () => {
    it("shows job error during active upload", () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            isProcessing: true,
            jobError: "Parse failed: invalid CSV",
          })}
        />
      );

      expect(
        screen.getByText("Parse failed: invalid CSV")
      ).toBeInTheDocument();
    });

    it("shows upload error during active upload", () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            isProcessing: true,
            uploadError: "S3 timeout",
          })}
        />
      );

      expect(screen.getByText("S3 timeout")).toBeInTheDocument();
    });
  });

  describe("Parse summary on job completion", () => {
    const PARSE_RESULTS = {
      parseResults: [
        {
          fileName: "contacts.csv",
          delimiter: ",",
          hasHeader: true,
          encoding: "utf-8",
          rowCount: 1500,
          headers: ["name", "email", "phone"],
          sampleRows: [["Alice", "alice@example.com", "555-0001"]],
          columnStats: [],
        },
        {
          fileName: "products.csv",
          delimiter: "\t",
          hasHeader: true,
          encoding: "utf-8",
          rowCount: 300,
          headers: ["id", "name"],
          sampleRows: [["1", "Widget"]],
          columnStats: [],
        },
      ],
    };

    it("shows parse summary when job completes with parseResults", () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            isProcessing: false,
            jobStatus: "completed",
            jobResult: PARSE_RESULTS,
          })}
        />
      );

      expect(
        screen.getByText("Successfully parsed 2 files")
      ).toBeInTheDocument();
      expect(screen.getByText("contacts.csv")).toBeInTheDocument();
      expect(screen.getByText("products.csv")).toBeInTheDocument();
    });

    it("displays row count and delimiter for each file", () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            isProcessing: false,
            jobStatus: "completed",
            jobResult: PARSE_RESULTS,
          })}
        />
      );

      expect(
        screen.getByText(/1,500 rows/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/delimiter: comma/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/300 rows/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/delimiter: tab/)
      ).toBeInTheDocument();
    });

    it("displays column count and encoding for each file", () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            isProcessing: false,
            jobStatus: "completed",
            jobResult: PARSE_RESULTS,
          })}
        />
      );

      expect(screen.getByText(/3 columns/)).toBeInTheDocument();
      expect(screen.getByText(/2 columns/)).toBeInTheDocument();
    });

    it("shows singular 'file' for single-file parse result", () => {
      render(
        <UploadStep
          {...makeProps({
            files: [MOCK_FILES[0]],
            uploadPhase: "done",
            isProcessing: false,
            jobStatus: "completed",
            jobResult: {
              parseResults: [PARSE_RESULTS.parseResults[0]],
            },
          })}
        />
      );

      expect(
        screen.getByText("Successfully parsed 1 file")
      ).toBeInTheDocument();
    });

    it("does not show parse summary when job is still active", () => {
      render(
        <UploadStep
          {...makeProps({
            files: MOCK_FILES,
            uploadPhase: "done",
            isProcessing: true,
            jobStatus: "active",
            jobResult: null,
          })}
        />
      );

      expect(
        screen.queryByText(/Successfully parsed/)
      ).not.toBeInTheDocument();
    });
  });

  describe("XLSX parse results", () => {
    const XLSX_PARSE_RESULTS = {
      parseResults: [
        {
          fileName: "data.xlsx[Contacts]",
          delimiter: "xlsx",
          hasHeader: true,
          encoding: "utf-8",
          rowCount: 100,
          headers: ["name", "email"],
          sampleRows: [["Alice", "a@x.com"]],
          columnStats: [],
        },
        {
          fileName: "data.xlsx[Deals]",
          delimiter: "xlsx",
          hasHeader: true,
          encoding: "utf-8",
          rowCount: 50,
          headers: ["title"],
          sampleRows: [["d1"]],
          columnStats: [],
        },
      ],
    };

    it("displays N/A delimiter for xlsx parse results", () => {
      render(
        <UploadStep
          {...makeProps({
            files: [new File([""], "data.xlsx", { type: "application/octet-stream" })],
            uploadPhase: "done",
            isProcessing: false,
            jobStatus: "completed",
            jobResult: XLSX_PARSE_RESULTS,
          })}
        />
      );

      const delimiterTexts = screen.getAllByText(/delimiter: N\/A/);
      expect(delimiterTexts.length).toBeGreaterThanOrEqual(2);
    });

    it("displays workbook name and sheet name separately", () => {
      render(
        <UploadStep
          {...makeProps({
            files: [new File([""], "data.xlsx", { type: "application/octet-stream" })],
            uploadPhase: "done",
            isProcessing: false,
            jobStatus: "completed",
            jobResult: XLSX_PARSE_RESULTS,
          })}
        />
      );

      // Each card renders the workbook name + " — sheet: " + sheet name as a single block
      expect(screen.getAllByText(/data\.xlsx/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/sheet: Contacts/)).toBeInTheDocument();
      expect(screen.getByText(/sheet: Deals/)).toBeInTheDocument();
    });

    it("renders one card per sheet for multi-sheet XLSX results", () => {
      render(
        <UploadStep
          {...makeProps({
            files: [new File([""], "data.xlsx", { type: "application/octet-stream" })],
            uploadPhase: "done",
            isProcessing: false,
            jobStatus: "completed",
            jobResult: XLSX_PARSE_RESULTS,
          })}
        />
      );

      expect(screen.getByText("Successfully parsed 2 files")).toBeInTheDocument();
      expect(screen.getByText(/100 rows/)).toBeInTheDocument();
      expect(screen.getByText(/50 rows/)).toBeInTheDocument();
    });
  });
});
