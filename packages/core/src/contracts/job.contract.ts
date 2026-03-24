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
  status: z.string().optional(),
  type: z.string().optional(),
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

// --- SSE Event Schemas ---

/** Snapshot sent on SSE connect with the current persisted job state. */
export const JobSnapshotEventSchema = z.object({
  jobId: z.string(),
  status: JobStatusEnum,
  progress: z.number(),
  error: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
});

export type JobSnapshotEvent = z.infer<typeof JobSnapshotEventSchema>;

/** Live update event published via Redis Pub/Sub and forwarded over SSE. */
export const JobUpdateEventSchema = z.object({
  jobId: z.string(),
  status: JobStatusEnum,
  progress: z.number(),
  error: z.string().nullable().optional(),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  timestamp: z.number(),
});

export type JobUpdateEvent = z.infer<typeof JobUpdateEventSchema>;
