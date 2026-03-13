import { z } from "zod";
import { JobSchema, JobStatusEnum, JobTypeEnum } from "../models/job.model.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";

// --- Request Schemas ---

export const JobCreateRequestBodySchema = z.object({
  type: JobTypeEnum,
  organizationId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type JobCreateRequestBody = z.infer<typeof JobCreateRequestBodySchema>;

export const JobListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  status: JobStatusEnum.optional(),
  type: JobTypeEnum.optional(),
});

export type JobListRequestQuery = z.infer<typeof JobListRequestQuerySchema>;

// --- Response Schemas ---

export const JobListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  jobs: z.array(JobSchema),
});

export type JobListResponsePayload = z.infer<typeof JobListResponsePayloadSchema>;

export const JobGetResponsePayloadSchema = z.object({
  job: JobSchema,
});

export type JobGetResponsePayload = z.infer<typeof JobGetResponsePayloadSchema>;

export const JobCreateResponsePayloadSchema = z.object({
  job: JobSchema,
});

export type JobCreateResponsePayload = z.infer<typeof JobCreateResponsePayloadSchema>;

export const JobCancelResponsePayloadSchema = z.object({
  job: JobSchema,
});

export type JobCancelResponsePayload = z.infer<typeof JobCancelResponsePayloadSchema>;
