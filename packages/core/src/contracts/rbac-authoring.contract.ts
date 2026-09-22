import { z } from "zod";
import {
  PermissionEffectSchema,
  PermissionVerbSchema,
  PermissionResourceTypeSchema,
  PermissionConditionSchema,
  RbacKindSchema,
} from "../models/permission.model.js";

/**
 * Wire contracts for RBAC custom authoring (#622) — the org-defined policy /
 * role / group layer over the #598 system RBAC. This file grows across the
 * feature's slices: the **policy** shapes land first (slice 3), roles (slice 4)
 * and groups + membership (slice 5) follow. Every authored `allow` statement is
 * boundary-checked server-side (`assertStatementsWithinBoundary`); the editor
 * imposes no restriction on what a policy may govern (OQ1/OQ2).
 */

// ── Policy ────────────────────────────────────────────────────────────

/** One statement row an author writes — the full vocabulary (wildcards,
 *  instance `resourceId`, ownership `condition`), no restriction. */
export const PolicyStatementInputSchema = z.object({
  effect: PermissionEffectSchema,
  verb: PermissionVerbSchema,
  resourceType: PermissionResourceTypeSchema,
  /** null = class-level (`type:*`); set = a specific instance (picked, not typed). */
  resourceId: z.string().nullable(),
  condition: PermissionConditionSchema.nullable(),
});
export type PolicyStatementInput = z.infer<typeof PolicyStatementInputSchema>;

/** `POST /api/policies` / `PUT /api/policies/:id` — a custom policy + its
 *  statements (≥1). Re-authoring replaces the statement set. */
export const PolicyUpsertRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  statements: z.array(PolicyStatementInputSchema).min(1),
});
export type PolicyUpsertRequest = z.infer<typeof PolicyUpsertRequestSchema>;

/** A policy as the UI reads it — its statements inlined. `kind` is `system`
 *  (read-only) or `custom`. */
export const PolicyViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: RbacKindSchema,
  description: z.string().nullable(),
  statements: z.array(PolicyStatementInputSchema),
});
export type PolicyView = z.infer<typeof PolicyViewSchema>;

export const PolicyResponseSchema = z.object({ policy: PolicyViewSchema });
export type PolicyResponse = z.infer<typeof PolicyResponseSchema>;

export const PolicyListResponseSchema = z.object({
  policies: z.array(PolicyViewSchema),
});
export type PolicyListResponse = z.infer<typeof PolicyListResponseSchema>;

// ── Role (a named policy bundle, #622 slice 4) ────────────────────────

/** `POST /api/roles` / `PUT /api/roles/:id` — a custom role bundling policies
 *  (the set of attached policy ids). Assignment to members reuses #620. */
export const RoleUpsertRequestSchema = z.object({
  name: z.string().min(1),
  policyIds: z.array(z.string()),
});
export type RoleUpsertRequest = z.infer<typeof RoleUpsertRequestSchema>;

/** A role as the UI reads it — its attached policy ids. `kind` is `system`
 *  (read-only) or `custom`. */
export const RoleViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: RbacKindSchema,
  policyIds: z.array(z.string()),
});
export type RoleView = z.infer<typeof RoleViewSchema>;

export const RoleResponseSchema = z.object({ role: RoleViewSchema });
export type RoleResponse = z.infer<typeof RoleResponseSchema>;

export const RoleListResponseSchema = z.object({
  roles: z.array(RoleViewSchema),
});
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;
