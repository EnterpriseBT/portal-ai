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
  /** Stable assignment key (#622) — decoupled from `name`. */
  slug: z.string(),
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

// ── Group (a member set + a policy bundle, #622 slice 5) ──────────────

/** `POST /api/groups` / `PUT /api/groups/:id` — a group's metadata + the
 *  policies it bundles (a member inherits them). Membership is set separately. */
export const GroupUpsertRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  policyIds: z.array(z.string()),
});
export type GroupUpsertRequest = z.infer<typeof GroupUpsertRequestSchema>;

/** A group as the UI reads it — its attached policies + a live member count. */
export const GroupViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  policyIds: z.array(z.string()),
  memberCount: z.number().int().nonnegative(),
});
export type GroupView = z.infer<typeof GroupViewSchema>;

export const GroupResponseSchema = z.object({ group: GroupViewSchema });
export type GroupResponse = z.infer<typeof GroupResponseSchema>;

export const GroupListResponseSchema = z.object({
  groups: z.array(GroupViewSchema),
});
export type GroupListResponse = z.infer<typeof GroupListResponseSchema>;

/** `PUT /api/groups/:id/members` — set the group's membership (group-centric). */
export const GroupMembersSetRequestSchema = z.object({
  userIds: z.array(z.string()),
});
export type GroupMembersSetRequest = z.infer<
  typeof GroupMembersSetRequestSchema
>;

/** `PUT /api/organization/members/:userId/groups` — set a member's groups
 *  (member-centric, the Members-tab path). */
export const MemberGroupsSetRequestSchema = z.object({
  groupIds: z.array(z.string()),
});
export type MemberGroupsSetRequest = z.infer<
  typeof MemberGroupsSetRequestSchema
>;

// ── Instance-object picker (#622 slice 5) ─────────────────────────────

/** `GET /api/rbac/objects?resourceType&search` — the searchable objects a
 *  policy author may pick as an instance-statement target. `{ id, label }`
 *  only, visibility-scoped to what the caller can see. */
export const RbacObjectSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type RbacObject = z.infer<typeof RbacObjectSchema>;

export const RbacObjectSearchResponseSchema = z.object({
  objects: z.array(RbacObjectSchema),
});
export type RbacObjectSearchResponse = z.infer<
  typeof RbacObjectSearchResponseSchema
>;
