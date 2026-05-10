import type { TypedJobProcessor } from "../jobs.worker.js";
import { FileUploadSessionService } from "../../services/file-upload-session.service.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "file-upload-parse-processor" });

/**
 * Processor for `file_upload_parse` jobs.
 *
 * The HTTP route at `POST /api/file-uploads/parse` mints the
 * `uploadSessionId` and enqueues this job after pre-flight validation
 * (org ownership, upload status). Here we drive the streaming parse
 * pipeline straight into the chunked Redis cache and hand back the
 * inline-preview payload — same shape the synchronous endpoint used
 * to return inline pre-Phase-3 (`docs/LARGE_FILE_PARSE_STREAMING.plan.md`).
 *
 * The worker's job lifecycle (active/completed/failed transitions and
 * progress events) is owned by `jobs.worker.ts`; on success the
 * returned `FileUploadParseJobResult` is stored on the job row and
 * broadcast via Redis Pub/Sub → SSE to the awaiting frontend.
 */
export const fileUploadParseProcessor: TypedJobProcessor<
  "file_upload_parse"
> = async (bullJob) => {
  const { jobId, organizationId, uploadSessionId, uploadIds } = bullJob.data;

  logger.info(
    { jobId, uploadSessionId, fileCount: uploadIds.length },
    "file_upload_parse started"
  );

  const result = await FileUploadSessionService.runParseSession(
    organizationId,
    uploadSessionId,
    uploadIds
  );

  logger.info(
    {
      jobId,
      uploadSessionId,
      sheetCount: result.sheets.length,
      sliced: result.sliced ?? false,
    },
    "file_upload_parse completed"
  );

  return result;
};
