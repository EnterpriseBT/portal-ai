import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

import type { UseFileUploadReturn, UploadPhase } from "../../../utils/file-upload.util";
import type { JobStreamState } from "../../../api/jobs.api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStartUpload = jest.fn<(files: File[], params: Record<string, string>) => Promise<string>>();
const mockFileUploadReset = jest.fn();

let mockFileUploadState: UseFileUploadReturn;

function createMockFileUploadState(overrides: Partial<UseFileUploadReturn> = {}): UseFileUploadReturn {
  return {
    phase: "idle" as UploadPhase,
    jobId: null,
    fileProgress: new Map(),
    overallPercent: 0,
    error: null,
    startUpload: mockStartUpload,
    reset: mockFileUploadReset,
    ...overrides,
  };
}

let mockStreamState: JobStreamState;

function createMockStreamState(overrides: Partial<JobStreamState> = {}): JobStreamState {
  return {
    jobId: null,
    status: null,
    progress: 0,
    error: null,
    result: null,
    startedAt: null,
    completedAt: null,
    connectionStatus: "idle",
    ...overrides,
  };
}

jest.unstable_mockModule("../../../utils/file-upload.util", () => ({
  useFileUpload: () => mockFileUploadState,
}));

jest.unstable_mockModule("../../../api/sdk", () => ({
  sdk: {
    jobs: {
      stream: () => mockStreamState,
    },
  },
}));

// Dynamic import after mocks
const { useUploadWorkflow } = await import("../utils/upload-workflow.util");
const { WORKFLOW_STEPS } = await import("../utils/upload-workflow.util");

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_FILES = [
  new File(["a,b,c"], "contacts.csv", { type: "text/csv" }),
  new File(["x,y"], "products.csv", { type: "text/csv" }),
];

const MOCK_RECOMMENDATIONS = {
  connectorInstance: { name: "My CSV Import", config: {} },
  entities: [
    {
      connectorEntity: { key: "contacts", label: "Contacts" },
      columns: [
        {
          action: "match_existing" as const,
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
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useUploadWorkflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileUploadState = createMockFileUploadState();
    mockStreamState = createMockStreamState();
  });

  describe("WORKFLOW_STEPS", () => {
    it("exports 4 step definitions", () => {
      expect(WORKFLOW_STEPS).toHaveLength(4);
      expect(WORKFLOW_STEPS[0].label).toBe("Upload CSV");
      expect(WORKFLOW_STEPS[3].label).toBe("Review & Import");
    });
  });

  describe("Initial state", () => {
    it("starts at step 0 with empty files", () => {
      const { result } = renderHook(() => useUploadWorkflow());

      expect(result.current.step).toBe(0);
      expect(result.current.files).toEqual([]);
      expect(result.current.jobId).toBeNull();
      expect(result.current.uploadPhase).toBe("idle");
      expect(result.current.recommendations).toBeNull();
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.canAdvance).toBe(false);
    });
  });

  describe("addFiles / removeFile", () => {
    it("adds files to the file list", () => {
      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.addFiles([MOCK_FILES[0]]);
      });
      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe("contacts.csv");

      act(() => {
        result.current.addFiles([MOCK_FILES[1]]);
      });
      expect(result.current.files).toHaveLength(2);
    });

    it("removes file at the given index", () => {
      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.addFiles(MOCK_FILES);
      });
      expect(result.current.files).toHaveLength(2);

      act(() => {
        result.current.removeFile(0);
      });
      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe("products.csv");
    });

    it("removes correct file when removing from the middle", () => {
      const { result } = renderHook(() => useUploadWorkflow());
      const threeFiles = [
        ...MOCK_FILES,
        new File(["z"], "extra.csv", { type: "text/csv" }),
      ];

      act(() => {
        result.current.addFiles(threeFiles);
      });

      act(() => {
        result.current.removeFile(1);
      });
      expect(result.current.files).toHaveLength(2);
      expect(result.current.files[0].name).toBe("contacts.csv");
      expect(result.current.files[1].name).toBe("extra.csv");
    });
  });

  describe("canAdvance", () => {
    it("returns false on step 0 when no files are selected", () => {
      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.canAdvance).toBe(false);
    });

    it("returns true on step 0 when files are selected and not processing", () => {
      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.addFiles([MOCK_FILES[0]]);
      });
      expect(result.current.canAdvance).toBe(true);
    });

    it("returns false on step 0 when files selected but processing", () => {
      mockFileUploadState = createMockFileUploadState({ phase: "uploading" });

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.addFiles([MOCK_FILES[0]]);
      });
      expect(result.current.canAdvance).toBe(false);
    });

    it("returns true on step 1 when recommendations are present", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());
      // Auto-advances to step 1 when recommendations arrive
      expect(result.current.step).toBe(1);
      expect(result.current.canAdvance).toBe(true);
    });

    it("returns false on step 3 (review is final)", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.goToStep(3);
      });
      expect(result.current.canAdvance).toBe(false);
    });
  });

  describe("startUpload", () => {
    it("does not call fileUpload.startUpload when no files selected", async () => {
      const { result } = renderHook(() => useUploadWorkflow());

      await act(async () => {
        await result.current.startUpload("org_1", "connDef_1");
      });

      expect(mockStartUpload).not.toHaveBeenCalled();
    });

    it("calls fileUpload.startUpload with correct params when files selected", async () => {
      mockStartUpload.mockResolvedValue("job_123");

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.addFiles([MOCK_FILES[0]]);
      });

      await act(async () => {
        await result.current.startUpload("org_1", "connDef_1");
      });

      expect(mockStartUpload).toHaveBeenCalledTimes(1);
      expect(mockStartUpload).toHaveBeenCalledWith(
        [expect.objectContaining({ name: "contacts.csv" })],
        { organizationId: "org_1", connectorDefinitionId: "connDef_1" },
      );
    });
  });

  describe("Step navigation — goNext / goBack / goToStep", () => {
    it("goNext increments step", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.step).toBe(1); // auto-advanced

      act(() => {
        result.current.goNext();
      });
      expect(result.current.step).toBe(2);

      act(() => {
        result.current.goNext();
      });
      expect(result.current.step).toBe(3);
    });

    it("goNext does not exceed step 3", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.goToStep(3);
      });
      expect(result.current.step).toBe(3);

      act(() => {
        result.current.goNext();
      });
      expect(result.current.step).toBe(3);
    });

    it("goBack decrements step", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.goToStep(2);
      });
      expect(result.current.step).toBe(2);

      act(() => {
        result.current.goBack();
      });
      expect(result.current.step).toBe(1);
    });

    it("goBack does not go below step 0", () => {
      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.goBack();
      });
      expect(result.current.step).toBe(0);
    });

    it("goToStep sets step directly", () => {
      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.goToStep(2);
      });
      expect(result.current.step).toBe(2);
    });
  });

  describe("Auto-advance on recommendations", () => {
    it("auto-advances to step 1 when recommendations arrive via SSE", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.step).toBe(1);
      expect(result.current.recommendations).toEqual(MOCK_RECOMMENDATIONS);
    });

    it("stays at step 0 when stream has no recommendations", () => {
      mockStreamState = createMockStreamState({ status: "active" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.step).toBe(0);
      expect(result.current.recommendations).toBeNull();
    });
  });

  describe("updateEntity / updateColumn / updateConnectorName", () => {
    it("updateEntity overrides AI-recommended entity", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.updateEntity(0, {
          connectorEntity: { key: "people", label: "People" },
        });
      });

      expect(result.current.recommendations?.entities[0].connectorEntity.key).toBe("people");
      expect(result.current.recommendations?.entities[0].connectorEntity.label).toBe("People");
    });

    it("updateColumn overrides AI-recommended column", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.updateColumn(0, 0, {
          action: "create_new",
          confidence: 0,
        });
      });

      expect(result.current.recommendations?.entities[0].columns[0].action).toBe("create_new");
      expect(result.current.recommendations?.entities[0].columns[0].confidence).toBe(0);
      // Other fields should remain from original
      expect(result.current.recommendations?.entities[0].columns[0].sourceField).toBe("Email Address");
    });

    it("updateConnectorName overrides AI-suggested name", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.updateConnectorName("Renamed Import");
      });

      expect(result.current.recommendations?.connectorInstance.name).toBe("Renamed Import");
    });

    it("edited values persist across step navigation", () => {
      mockStreamState = createMockStreamState({
        status: "awaiting_confirmation",
        result: { recommendations: MOCK_RECOMMENDATIONS },
      });

      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.updateConnectorName("Edited Name");
      });

      act(() => {
        result.current.goNext();
      });
      act(() => {
        result.current.goBack();
      });

      expect(result.current.recommendations?.connectorInstance.name).toBe("Edited Name");
    });
  });

  describe("isProcessing", () => {
    it("returns true during presigning phase", () => {
      mockFileUploadState = createMockFileUploadState({ phase: "presigning" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.isProcessing).toBe(true);
    });

    it("returns true during uploading phase", () => {
      mockFileUploadState = createMockFileUploadState({ phase: "uploading" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.isProcessing).toBe(true);
    });

    it("returns true during processing phase", () => {
      mockFileUploadState = createMockFileUploadState({ phase: "processing" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.isProcessing).toBe(true);
    });

    it("returns true when done but stream is still active", () => {
      mockFileUploadState = createMockFileUploadState({ phase: "done" });
      mockStreamState = createMockStreamState({ status: "active" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.isProcessing).toBe(true);
    });

    it("returns false when done and stream is awaiting_confirmation", () => {
      mockFileUploadState = createMockFileUploadState({ phase: "done" });
      mockStreamState = createMockStreamState({ status: "awaiting_confirmation" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.isProcessing).toBe(false);
    });

    it("returns false in idle state", () => {
      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe("Derived state passthrough", () => {
    it("exposes jobId from fileUpload", () => {
      mockFileUploadState = createMockFileUploadState({ jobId: "job_abc" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.jobId).toBe("job_abc");
    });

    it("exposes uploadPhase from fileUpload", () => {
      mockFileUploadState = createMockFileUploadState({ phase: "uploading" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.uploadPhase).toBe("uploading");
    });

    it("exposes jobProgress from stream", () => {
      mockStreamState = createMockStreamState({ progress: 42 });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.jobProgress).toBe(42);
    });

    it("exposes connectionStatus from stream", () => {
      mockStreamState = createMockStreamState({ connectionStatus: "error" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.connectionStatus).toBe("error");
    });

    it("exposes jobError from stream or fileUpload", () => {
      mockStreamState = createMockStreamState({ error: "Stream error" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.jobError).toBe("Stream error");
    });

    it("falls back to fileUpload error when stream error is null", () => {
      mockFileUploadState = createMockFileUploadState({ error: "Upload error" });

      const { result } = renderHook(() => useUploadWorkflow());
      expect(result.current.jobError).toBe("Upload error");
    });
  });

  describe("reset", () => {
    it("clears all state back to initial", () => {
      const { result } = renderHook(() => useUploadWorkflow());

      act(() => {
        result.current.addFiles(MOCK_FILES);
        result.current.goToStep(2);
      });

      expect(result.current.files).toHaveLength(2);
      expect(result.current.step).toBe(2);

      act(() => {
        result.current.reset();
      });

      expect(result.current.files).toEqual([]);
      expect(result.current.step).toBe(0);
      expect(mockFileUploadReset).toHaveBeenCalledTimes(1);
    });
  });
});
