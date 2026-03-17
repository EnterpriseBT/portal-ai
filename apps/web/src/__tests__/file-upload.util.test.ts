import { jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mock XMLHttpRequest
// ---------------------------------------------------------------------------

type XHRListener = (event: ProgressEvent | Event) => void;

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  static lastInstance: MockXMLHttpRequest | null = null;

  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 200;
  readyState = 0;

  upload = {
    _listeners: new Map<string, XHRListener[]>(),
    addEventListener(type: string, listener: XHRListener) {
      const list = this._listeners.get(type) || [];
      list.push(listener);
      this._listeners.set(type, list);
    },
  };

  private _listeners = new Map<string, XHRListener[]>();

  constructor() {
    MockXMLHttpRequest.instances.push(this);
    MockXMLHttpRequest.lastInstance = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: unknown) {
    this.body = body;
  }

  addEventListener(type: string, listener: XHRListener) {
    const list = this._listeners.get(type) || [];
    list.push(listener);
    this._listeners.set(type, list);
  }

  // --- Test helpers ---

  __emitUploadProgress(loaded: number, total: number) {
    const event = { lengthComputable: true, loaded, total } as ProgressEvent;
    this.upload._listeners.get("progress")?.forEach((fn) => fn(event));
  }

  __completeWith(status: number) {
    this.status = status;
    const event = new Event("load");
    this._listeners.get("load")?.forEach((fn) => fn(event));
  }

  __emitError() {
    const event = new Event("error");
    this._listeners.get("error")?.forEach((fn) => fn(event));
  }

  __emitAbort() {
    const event = new Event("abort");
    this._listeners.get("abort")?.forEach((fn) => fn(event));
  }

  static reset() {
    MockXMLHttpRequest.instances = [];
    MockXMLHttpRequest.lastInstance = null;
  }
}

Object.defineProperty(globalThis, "XMLHttpRequest", {
  value: MockXMLHttpRequest,
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Mock Auth0
// ---------------------------------------------------------------------------

const mockGetAccessTokenSilently = jest.fn<(...args: unknown[]) => Promise<string>>();

jest.unstable_mockModule("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: mockGetAccessTokenSilently,
  }),
}));

// ---------------------------------------------------------------------------
// Mock SDK
// ---------------------------------------------------------------------------

const mockPresign = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    uploads: {
      presign: () => ({ mutateAsync: mockPresign }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock fetch (for process endpoint)
// ---------------------------------------------------------------------------

const mockFetch = jest.fn<(...args: unknown[]) => Promise<Response>>();
Object.defineProperty(globalThis, "fetch", {
  value: mockFetch,
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks)
// ---------------------------------------------------------------------------

const { renderHook, act, waitFor } = await import("./test-utils");
const { useFileUpload } = await import("../utils/file-upload.util");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(typeof body === "string" ? JSON.parse(body) : body),
  } as Response;
}

const PRESIGN_PARAMS = {
  organizationId: "org_123",
  connectorDefinitionId: "cdef_csv01",
};

const PRESIGN_RESPONSE = {
  jobId: "job_abc",
  uploads: [
    {
      fileName: "contacts.csv",
      s3Key: "uploads/org_123/job_abc/contacts.csv",
      presignedUrl: "https://s3.example.com/presigned/contacts.csv",
      expiresIn: 900,
    },
  ],
};

const PRESIGN_RESPONSE_MULTI = {
  jobId: "job_abc",
  uploads: [
    {
      fileName: "contacts.csv",
      s3Key: "uploads/org_123/job_abc/contacts.csv",
      presignedUrl: "https://s3.example.com/presigned/contacts.csv",
      expiresIn: 900,
    },
    {
      fileName: "products.csv",
      s3Key: "uploads/org_123/job_abc/products.csv",
      presignedUrl: "https://s3.example.com/presigned/products.csv",
      expiresIn: 900,
    },
  ],
};

function createMockFile(name: string, size: number, type = "text/csv"): File {
  const content = new ArrayBuffer(size);
  return new File([content], name, { type });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFileUpload", () => {
  beforeEach(() => {
    MockXMLHttpRequest.reset();
    mockGetAccessTokenSilently.mockResolvedValue("test-token");
    mockPresign.mockReset();
    mockFetch.mockReset();
  });

  // --- Initial state ---

  it("should return idle initial state", () => {
    const { result } = renderHook(() => useFileUpload());

    expect(result.current.phase).toBe("idle");
    expect(result.current.jobId).toBeNull();
    expect(result.current.fileProgress.size).toBe(0);
    expect(result.current.overallPercent).toBe(0);
    expect(result.current.error).toBeNull();
  });

  // --- Full upload flow ---

  it("should complete full presign → S3 upload → process flow", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);
    mockFetch.mockResolvedValue(mockResponse({ payload: {} }));

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("contacts.csv", 1024);

    let uploadPromise: Promise<string>;
    act(() => {
      uploadPromise = result.current.startUpload([file], PRESIGN_PARAMS);
    });

    // Wait for presign to complete and XHR to be created
    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    const xhr = MockXMLHttpRequest.instances[0];

    // Verify S3 PUT request
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("https://s3.example.com/presigned/contacts.csv");
    expect(xhr.headers["Content-Type"]).toBe("text/csv");

    // Simulate S3 upload completing
    act(() => {
      xhr.__completeWith(200);
    });

    // Wait for process call
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(fetchUrl).toBe("/api/uploads/job_abc/process");
    expect(fetchOptions.method).toBe("POST");
    expect(fetchOptions.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer test-token" }),
    );

    const jobId = await act(async () => uploadPromise!);
    expect(jobId).toBe("job_abc");
    expect(result.current.phase).toBe("done");
    expect(result.current.jobId).toBe("job_abc");
  });

  // --- Presign params ---

  it("should build presign body from files and params", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);
    mockFetch.mockResolvedValue(mockResponse({}));

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("data.json", 2048, "application/json");

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS);
    });

    await waitFor(() => {
      expect(mockPresign).toHaveBeenCalledWith({
        organizationId: "org_123",
        connectorDefinitionId: "cdef_csv01",
        files: [
          {
            fileName: "data.json",
            contentType: "application/json",
            sizeBytes: 2048,
          },
        ],
      });
    });
  });

  it("should default contentType to application/octet-stream when file.type is empty", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("mystery", 512, "");

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS);
    });

    await waitFor(() => {
      expect(mockPresign).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [
            expect.objectContaining({ contentType: "application/octet-stream" }),
          ],
        }),
      );
    });
  });

  // --- Upload progress ---

  it("should track per-file upload progress", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("contacts.csv", 1000);

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS);
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    const xhr = MockXMLHttpRequest.instances[0];

    act(() => {
      xhr.__emitUploadProgress(500, 1000);
    });

    expect(result.current.phase).toBe("uploading");
    const progress = result.current.fileProgress.get("contacts.csv");
    expect(progress).toEqual({
      fileName: "contacts.csv",
      loaded: 500,
      total: 1000,
      percent: 50,
    });
    expect(result.current.overallPercent).toBe(50);
  });

  it("should track overall progress across multiple files", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE_MULTI);

    const { result } = renderHook(() => useFileUpload());
    const file1 = createMockFile("contacts.csv", 1000);
    const file2 = createMockFile("products.csv", 3000);

    act(() => {
      result.current.startUpload([file1, file2], PRESIGN_PARAMS);
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(2);
    });

    const [xhr1, xhr2] = MockXMLHttpRequest.instances;

    // File 1: 100% done (1000/1000), File 2: 0% — overall = 25%
    act(() => {
      xhr1.__emitUploadProgress(1000, 1000);
    });

    expect(result.current.overallPercent).toBe(25);

    // File 2: 50% done (1500/3000) — overall = (1000+1500)/4000 = 62.5% → 63%
    act(() => {
      xhr2.__emitUploadProgress(1500, 3000);
    });

    expect(result.current.overallPercent).toBe(63);
  });

  // --- Parallel S3 uploads ---

  it("should upload multiple files in parallel", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE_MULTI);
    mockFetch.mockResolvedValue(mockResponse({}));

    const { result } = renderHook(() => useFileUpload());
    const file1 = createMockFile("contacts.csv", 1000);
    const file2 = createMockFile("products.csv", 2000);

    act(() => {
      result.current.startUpload([file1, file2], PRESIGN_PARAMS);
    });

    // Both XHRs should be created immediately (parallel)
    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(2);
    });

    expect(MockXMLHttpRequest.instances[0].url).toBe(
      "https://s3.example.com/presigned/contacts.csv",
    );
    expect(MockXMLHttpRequest.instances[1].url).toBe(
      "https://s3.example.com/presigned/products.csv",
    );

    // Complete both
    act(() => {
      MockXMLHttpRequest.instances[0].__completeWith(200);
      MockXMLHttpRequest.instances[1].__completeWith(200);
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("done");
    });
  });

  // --- S3 upload errors ---

  it("should set error phase when S3 upload returns non-2xx", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("contacts.csv", 1024);

    let rejected = false;
    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS).catch(() => {
        rejected = true;
      });
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    act(() => {
      MockXMLHttpRequest.instances[0].__completeWith(403);
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    expect(result.current.error).toContain("S3 upload failed");
    expect(result.current.error).toContain("403");
    expect(rejected).toBe(true);
  });

  it("should set error phase on network error during S3 upload", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("contacts.csv", 1024);

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS).catch(() => {});
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    act(() => {
      MockXMLHttpRequest.instances[0].__emitError();
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    expect(result.current.error).toContain("Network error");
  });

  it("should set error phase on aborted S3 upload", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("contacts.csv", 1024);

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS).catch(() => {});
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    act(() => {
      MockXMLHttpRequest.instances[0].__emitAbort();
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    expect(result.current.error).toContain("aborted");
  });

  // --- Presign errors ---

  it("should set error phase when presign fails", async () => {
    mockPresign.mockRejectedValue(new Error("Presign failed: 400"));

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("contacts.csv", 1024);

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS).catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    expect(result.current.error).toBe("Presign failed: 400");
    expect(MockXMLHttpRequest.instances).toHaveLength(0);
  });

  // --- Process errors ---

  it("should set error phase when process endpoint fails", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);
    mockFetch.mockResolvedValue(mockResponse({ message: "Job not found" }, 404));

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("contacts.csv", 1024);

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS).catch(() => {});
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    act(() => {
      MockXMLHttpRequest.instances[0].__completeWith(200);
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    expect(result.current.error).toBe("Job not found");
  });

  // --- Reset ---

  it("should reset state to initial values", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);
    mockFetch.mockResolvedValue(mockResponse({}));

    const { result } = renderHook(() => useFileUpload());
    const file = createMockFile("contacts.csv", 1024);

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS);
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    act(() => {
      MockXMLHttpRequest.instances[0].__completeWith(200);
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("done");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.jobId).toBeNull();
    expect(result.current.fileProgress.size).toBe(0);
    expect(result.current.overallPercent).toBe(0);
    expect(result.current.error).toBeNull();
  });

  // --- Phase transitions ---

  it("should transition through phases in order: presigning → uploading → processing → done", async () => {
    mockPresign.mockResolvedValue(PRESIGN_RESPONSE);
    mockFetch.mockResolvedValue(mockResponse({}));

    const phases: string[] = [];
    const { result } = renderHook(() => {
      const hook = useFileUpload();
      // Capture phase on each render
      if (phases[phases.length - 1] !== hook.phase) {
        phases.push(hook.phase);
      }
      return hook;
    });

    const file = createMockFile("contacts.csv", 1024);

    act(() => {
      result.current.startUpload([file], PRESIGN_PARAMS);
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    act(() => {
      MockXMLHttpRequest.instances[0].__completeWith(200);
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("done");
    });

    // "processing" may be batched with "done" in a single React render cycle
    expect(phases[0]).toBe("idle");
    expect(phases[1]).toBe("presigning");
    expect(phases[2]).toBe("uploading");
    expect(phases[phases.length - 1]).toBe("done");
  });
});
