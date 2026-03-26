import { z } from "zod";

import {
  OrganizationToolImplementationSchema,
  OrganizationToolSchema,
} from "../models/organization-tool.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const OrganizationToolListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    search: z.string().optional(),
  });

export type OrganizationToolListRequestQuery = z.infer<
  typeof OrganizationToolListRequestQuerySchema
>;

export const OrganizationToolListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    organizationTools: z.array(OrganizationToolSchema),
  });

export type OrganizationToolListResponsePayload = z.infer<
  typeof OrganizationToolListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const OrganizationToolGetResponsePayloadSchema = z.object({
  organizationTool: OrganizationToolSchema,
});

export type OrganizationToolGetResponsePayload = z.infer<
  typeof OrganizationToolGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const CreateOrganizationToolBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameterSchema: z.record(z.string(), z.unknown()),
  implementation: OrganizationToolImplementationSchema,
});

export type CreateOrganizationToolBody = z.infer<
  typeof CreateOrganizationToolBodySchema
>;

export const OrganizationToolCreateResponsePayloadSchema = z.object({
  organizationTool: OrganizationToolSchema,
});

export type OrganizationToolCreateResponsePayload = z.infer<
  typeof OrganizationToolCreateResponsePayloadSchema
>;

// ── Update ────────────────────────────────────────────────────────────

export const UpdateOrganizationToolBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    parameterSchema: z.record(z.string(), z.unknown()).optional(),
    implementation: OrganizationToolImplementationSchema.optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export type UpdateOrganizationToolBody = z.infer<
  typeof UpdateOrganizationToolBodySchema
>;

export const OrganizationToolUpdateResponsePayloadSchema = z.object({
  organizationTool: OrganizationToolSchema,
});

export type OrganizationToolUpdateResponsePayload = z.infer<
  typeof OrganizationToolUpdateResponsePayloadSchema
>;
