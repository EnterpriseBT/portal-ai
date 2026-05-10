import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

const mockRunParseSession =
  jest.fn<
    (
      orgId: string,
      uploadSessionId: string,
      uploadIds: string[]
    ) => Promise<{
      uploadSessionId: string;
      sheets: unknown[];
      sliced?: boolean;
    }>
  >();

jest.unstable_mockModule(
  "../../../services/file-upload-session.service.js",
  () => ({
    FileUploadSessionService: { runParseSession: mockRunParseSession },
  })
);

const { fileUploadParseProcessor } = await import(
  "../../../queues/processors/file-upload-parse.processor.js"
);

function makeBullJob(data: Record<string, unknown>): BullJob {
  return {
    data: { jobId: "job-1", type: "file_upload_parse", ...data },
  } as unknown as BullJob;
}

describe("fileUploadParseProcessor", () => {
  beforeEach(() => {
    mockRunParseSession.mockReset();
  });

  it("forwards (organizationId, uploadSessionId, uploadIds) to runParseSession", async () => {
    mockRunParseSession.mockResolvedValue({
      uploadSessionId: "sess-1",
      sheets: [],
    });
    const bullJob = makeBullJob({
      organizationId: "org-1",
      uploadSessionId: "sess-1",
      uploadIds: ["u1", "u2"],
    });

    await fileUploadParseProcessor(bullJob as never);

    expect(mockRunParseSession).toHaveBeenCalledWith(
      "org-1",
      "sess-1",
      ["u1", "u2"]
    );
  });

  it("returns the runParseSession result verbatim — that's what lands as the SSE payload", async () => {
    const result = {
      uploadSessionId: "sess-1",
      sheets: [{ id: "sheet_0_x", name: "x", dimensions: { rows: 1, cols: 1 }, cells: [["v"]] }],
      sliced: false,
    };
    mockRunParseSession.mockResolvedValue(result);

    const out = await fileUploadParseProcessor(
      makeBullJob({
        organizationId: "org-1",
        uploadSessionId: "sess-1",
        uploadIds: ["u1"],
      }) as never
    );

    expect(out).toBe(result);
  });

  it("propagates errors so the worker can mark the job failed", async () => {
    mockRunParseSession.mockRejectedValue(
      new Error("Upload xyz belongs to a different organization")
    );

    await expect(
      fileUploadParseProcessor(
        makeBullJob({
          organizationId: "org-1",
          uploadSessionId: "sess-bad",
          uploadIds: ["xyz"],
        }) as never
      )
    ).rejects.toThrow("Upload xyz belongs to a different organization");
  });
});
