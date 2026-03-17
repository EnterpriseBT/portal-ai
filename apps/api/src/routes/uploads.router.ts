import { Router, Request, Response, NextFunction } from "express";

import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { S3Service } from "../services/s3.service.js";
import { DbService } from "../services/db.service.js";
import {
  FileUploadJobModelFactory,
  type FileUploadMetadata,
} from "@portalai/core/models";
import {
  PresignRequestBodySchema,
  type PresignFile,
  type PresignResponsePayload,
  type PresignUploadItem,
  type ProcessResponsePayload,
} from "@portalai/core/contracts";
import { environment } from "../environment.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { jobsQueue } from "../queues/jobs.queue.js";

const logger = createLogger({ module: "uploads" });

export const uploadsRouter = Router();

const MAX_FILE_SIZE_BYTES = environment.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * @openapi
 * /api/uploads/presign:
 *   post:
 *     tags:
 *       - Uploads
 *     summary: Request presigned S3 URLs for file uploads
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - organizationId
 *               - connectorDefinitionId
 *               - files
 *             properties:
 *               organizationId:
 *                 type: string
 *               connectorDefinitionId:
 *                 type: string
 *               files:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     fileName:
 *                       type: string
 *                     contentType:
 *                       type: string
 *                     sizeBytes:
 *                       type: number
 *     responses:
 *       200:
 *         description: Presigned URLs generated
 *       400:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */
uploadsRouter.post(
  "/presign",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = PresignRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(400, ApiCode.UPLOAD_INVALID_PAYLOAD, "Invalid presign request body")
        );
      }

      const { files, connectorDefinitionId } = parsed.data;
      const organizationId = req.application?.metadata.organizationId as string;
      const userId = req.application?.metadata.userId as string;

      // Validate file count
      if (files.length === 0) {
        return next(
          new ApiError(400, ApiCode.UPLOAD_NO_FILES, "At least one file is required")
        );
      }
      if (files.length > environment.UPLOAD_MAX_FILES) {
        return next(
          new ApiError(
            400,
            ApiCode.UPLOAD_TOO_MANY_FILES,
            `Maximum ${environment.UPLOAD_MAX_FILES} files allowed`
          )
        );
      }

      // Validate each file
      for (const file of files) {
        const ext = file.fileName.substring(file.fileName.lastIndexOf(".")).toLowerCase();
        if (!environment.UPLOAD_ALLOWED_EXTENSIONS.includes(ext)) {
          return next(
            new ApiError(
              400,
              ApiCode.UPLOAD_INVALID_FILE_TYPE,
              `File type "${ext}" is not allowed. Allowed: ${environment.UPLOAD_ALLOWED_EXTENSIONS.join(", ")}`
            )
          );
        }

        if (file.sizeBytes > MAX_FILE_SIZE_BYTES) {
          return next(
            new ApiError(
              400,
              ApiCode.UPLOAD_FILE_TOO_LARGE,
              `File "${file.fileName}" exceeds maximum size of ${environment.UPLOAD_MAX_FILE_SIZE_MB}MB`
            )
          );
        }
      }

      // Create a pending file_upload job with placeholder S3 keys
      const factory = new FileUploadJobModelFactory();
      const model = factory.createForUpload(userId, {
        organizationId,
        connectorDefinitionId,
        files: files.map((f: PresignFile) => ({
          originalName: f.fileName,
          s3Key: "", // filled after presign
          sizeBytes: f.sizeBytes,
        })),
      });

      const job = await DbService.repository.jobs.create(model.parse());

      // Generate S3 keys and presigned URLs
      const uploads = await Promise.all(
        files.map(async (file: PresignFile) => {
          const s3Key = `${environment.UPLOAD_S3_PREFIX}/${organizationId}/${job.id}/${file.fileName}`;
          const presignedUrl = await S3Service.createPresignedUpload(
            s3Key,
            file.contentType,
            environment.UPLOAD_S3_PRESIGN_EXPIRY_SEC
          );
          return {
            fileName: file.fileName,
            s3Key,
            presignedUrl,
            expiresIn: environment.UPLOAD_S3_PRESIGN_EXPIRY_SEC,
          };
        })
      ).catch((error) => {
        throw new ApiError(
          500,
          ApiCode.UPLOAD_S3_ERROR,
          error instanceof Error ? error.message : "Failed to generate presigned URLs"
        );
      });

      // Update job metadata with actual S3 keys
      const updatedMetadata: FileUploadMetadata = {
        ...model.fileUploadMetadata,
        files: uploads.map((u: PresignUploadItem, i: number) => ({
          originalName: files[i].fileName,
          s3Key: u.s3Key,
          sizeBytes: files[i].sizeBytes,
        })),
      };
      await DbService.repository.jobs.update(job.id, {
        metadata: updatedMetadata as Record<string, unknown>,
      });

      logger.info({ jobId: job.id, fileCount: files.length }, "Presigned URLs generated");

      return HttpService.success<PresignResponsePayload>(res, {
        jobId: job.id,
        uploads,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to generate presigned URLs"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.UPLOAD_S3_ERROR, "Failed to generate presigned URLs")
      );
    }
  }
);

/**
 * @openapi
 * /api/uploads/{jobId}/process:
 *   post:
 *     tags:
 *       - Uploads
 *     summary: Signal that uploads are complete and processing should begin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       202:
 *         description: Job enqueued for processing
 *       400:
 *         description: Validation error or files missing from S3
 *       404:
 *         description: Job not found
 *       500:
 *         description: Internal server error
 */
uploadsRouter.post(
  "/:jobId/process",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jobId } = req.params;
      const organizationId = req.application?.metadata.organizationId as string;

      // Find the job
      const job = await DbService.repository.jobs.findById(jobId);
      if (!job) {
        return next(new ApiError(404, ApiCode.JOB_NOT_FOUND, "Job not found"));
      }

      // Verify org ownership
      if (job.organizationId !== organizationId) {
        return next(new ApiError(403, ApiCode.JOB_UNAUTHORIZED, "Job belongs to a different organization"));
      }

      // Verify job is pending
      if (job.status !== "pending") {
        return next(
          new ApiError(400, ApiCode.UPLOAD_JOB_NOT_PENDING, `Job is not pending (current status: ${job.status})`)
        );
      }

      // Verify all files exist in S3
      const metadata = job.metadata as unknown as FileUploadMetadata;
      for (const file of metadata.files) {
        const head = await S3Service.headObject(file.s3Key).catch((error) => {
          throw new ApiError(
            500,
            ApiCode.UPLOAD_S3_ERROR,
            error instanceof Error ? error.message : "Failed to verify file in S3"
          );
        });

        if (!head) {
          return next(
            new ApiError(
              400,
              ApiCode.UPLOAD_FILE_MISSING,
              `File "${file.originalName}" was not found in S3 at key "${file.s3Key}"`
            )
          );
        }
      }

      // Enqueue the job in BullMQ
      try {
        const bullJob = await jobsQueue.add("file_upload", {
          jobId: job.id,
          type: "file_upload" as const,
          ...metadata,
        });

        await DbService.repository.jobs.update(job.id, {
          bullJobId: bullJob.id,
        });

        logger.info({ jobId: job.id, bullJobId: bullJob.id }, "File upload job enqueued");
      } catch (err) {
        await DbService.repository.jobs.update(job.id, {
          status: "failed",
          error: err instanceof Error ? err.message : "Failed to enqueue job",
        });
        throw new ApiError(500, ApiCode.JOB_ENQUEUE_FAILED, "Failed to enqueue job");
      }

      // Refetch to get updated bullJobId
      const updatedJob = await DbService.repository.jobs.findById(jobId);

      return HttpService.success<ProcessResponsePayload>(
        res,
        { job: updatedJob! },
        202
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to process upload"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(500, ApiCode.UPLOAD_S3_ERROR, "Failed to process upload")
      );
    }
  }
);
