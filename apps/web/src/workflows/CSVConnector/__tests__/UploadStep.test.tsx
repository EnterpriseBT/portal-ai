import { jest } from "@jest/globals";

import { render, screen } from "../../../__tests__/test-utils";

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
        screen.getByText("Select one or more CSV files to upload.")
      ).toBeInTheDocument();
    });

    it("renders FileUploader with .csv accept attribute", () => {
      render(<UploadStep {...makeProps()} />);
      expect(
        screen.getByText(/Accepted formats: .csv/)
      ).toBeInTheDocument();
    });

    it("shows file picker on error phase when not processing", () => {
      render(
        <UploadStep
          {...makeProps({ uploadPhase: "error", isProcessing: false })}
        />
      );
      expect(
        screen.getByText("Select one or more CSV files to upload.")
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

    it('shows "Parsing CSV files..." when done with jobProgress < 30', () => {
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
      expect(screen.getByText("Parsing CSV files...")).toBeInTheDocument();
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
});
