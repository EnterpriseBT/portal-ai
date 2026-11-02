/**
 * AdminStore (#190) — the data seam every command talks through. Today's
 * implementation is DB-backed (drizzle over the env connection, the confirmed
 * permanent path for owner tooling); an API-backed implementation slots in
 * behind the same interface when the public customer CLI exists.
 *
 * Semantics mirror apps/api's repository layer (parity-pinned): every read
 * filters `deleted IS NULL`; every mutation is a single-row, id-scoped
 * statement stamping the audit columns.
 *
 * Slice 1: reads. Mutations land in slice 2.
 */

import { randomUUID } from "node:crypto";

import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { OrganizationUserModelFactory } from "@portalai/core/models";
import type { Organization, User } from "@portalai/core/models";

import { AdminConflictError, AdminNotFoundError } from "./errors.js";
import {
  auditLog,
  organizations,
  organizationUsers,
  stations,
  tiers,
  users,
} from "./tables.js";

const DEFAULT_LIMIT = 50;

export interface ListOrgsOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ListUsersOptions {
  orgId?: string;
  limit?: number;
  offset?: number;
}

export type OrgPatch = Partial<
  Pick<Organization, "name" | "timezone" | "defaultStationId">
>;

/** #936: what an org update actually changed (fields whose value moved). */
export interface OrgChanges {
  name?: { from: string; to: string };
  timezone?: { from: string; to: string };
  defaultStationId?: {
    from: string | null;
    to: string | null;
    fromName: string | null;
    toName: string | null;
  };
}

export interface OrgUpdateResult {
  org: Organization;
  changes: OrgChanges;
}

export interface AdminStore {
  /** Live orgs, name-searchable (ILIKE), created desc, paginated. */
  listOrgs(opts: ListOrgsOptions): Promise<Organization[]>;
  /** Live org by id → ADMIN_NOT_FOUND otherwise. */
  getOrg(id: string): Promise<Organization>;
  /** Patch a live org, stamping updated/updatedBy. #936: in one transaction
   *  with the org row locked; a new default station must be a live station in
   *  the org (else ADMIN_NOT_FOUND); a changed name or default station records
   *  the app's `org.update` entry. Returns what changed. */
  updateOrg(
    id: string,
    patch: OrgPatch,
    actor: string
  ): Promise<OrgUpdateResult>;
  /** Assign a tier (slug must exist live in `tiers`); returns the previous. */
  setTier(
    id: string,
    tierSlug: string,
    actor: string
  ): Promise<{ id: string; tier: string; previousTier: string }>;
  /** Soft-delete a live org (deleted/deletedBy stamps). */
  softDeleteOrg(id: string, actor: string): Promise<void>;
  /** Live users; `orgId` filters via LIVE membership. */
  listUsers(opts: ListUsersOptions): Promise<User[]>;
  /** Live user by email → ADMIN_NOT_FOUND otherwise. */
  getUserByEmail(email: string): Promise<User>;
  /** Add a membership: live duplicate → ADMIN_CONFLICT; soft-deleted → revive. */
  addMember(orgId: string, userId: string, actor: string): Promise<void>;
  /** Soft-delete a live membership → ADMIN_NOT_FOUND when absent. */
  removeMember(orgId: string, userId: string, actor: string): Promise<void>;
  /** Bump a live membership's lastLogin — the app's current-org selector. */
  switchMember(orgId: string, userId: string, actor: string): Promise<void>;
  close(): Promise<void>;
}

/** Store over an existing drizzle database (tests inject PGlite here). */
export function createAdminStore(
  db: PostgresJsDatabase,
  onClose: () => Promise<void> = async () => {}
): AdminStore {
  return {
    async listOrgs(opts) {
      const conditions = [isNull(organizations.deleted)];
      if (opts.search) {
        conditions.push(ilike(organizations.name, `%${opts.search}%`));
      }
      const rows = await db
        .select()
        .from(organizations)
        .where(and(...conditions))
        .orderBy(desc(organizations.created))
        .limit(opts.limit ?? DEFAULT_LIMIT)
        .offset(opts.offset ?? 0);
      return rows as Organization[];
    },

    async getOrg(id) {
      const [row] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.id, id), isNull(organizations.deleted)))
        .limit(1);
      if (!row) throw new AdminNotFoundError(`Organization ${id} not found`);
      return row as Organization;
    },

    async listUsers(opts) {
      if (opts.orgId) {
        const rows = await db
          .select({ user: users })
          .from(organizationUsers)
          .innerJoin(users, eq(organizationUsers.userId, users.id))
          .where(
            and(
              eq(organizationUsers.organizationId, opts.orgId),
              isNull(organizationUsers.deleted),
              isNull(users.deleted)
            )
          )
          .orderBy(desc(users.created))
          .limit(opts.limit ?? DEFAULT_LIMIT)
          .offset(opts.offset ?? 0);
        return rows.map((r) => r.user) as User[];
      }
      const rows = await db
        .select()
        .from(users)
        .where(isNull(users.deleted))
        .orderBy(desc(users.created))
        .limit(opts.limit ?? DEFAULT_LIMIT)
        .offset(opts.offset ?? 0);
      return rows as User[];
    },

    async getUserByEmail(email) {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deleted)))
        .limit(1);
      if (!row) throw new AdminNotFoundError(`User ${email} not found`);
      return row as User;
    },

    async updateOrg(id, patch, actor) {
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(organizations)
          .where(and(eq(organizations.id, id), isNull(organizations.deleted)))
          .for("update");
        if (!current)
          throw new AdminNotFoundError(`Organization ${id} not found`);

        const stationName = async (stationId: string | null) => {
          if (!stationId) return null;
          const [row] = await tx
            .select({ name: stations.name })
            .from(stations)
            .where(
              and(
                eq(stations.id, stationId),
                eq(stations.organizationId, id),
                isNull(stations.deleted)
              )
            )
            .limit(1);
          return row?.name ?? null;
        };

        // A new default must be a live station in this org, as the app's
        // PATCH requires; the CLI used to write any id.
        let toName: string | null = null;
        if (patch.defaultStationId) {
          toName = await stationName(patch.defaultStationId);
          if (toName === null) {
            throw new AdminNotFoundError(
              `Station ${patch.defaultStationId} not found in organization ${id}`
            );
          }
        }

        const [row] = await tx
          .update(organizations)
          .set({ ...patch, updated: Date.now(), updatedBy: actor })
          .where(eq(organizations.id, id))
          .returning();
        const org = row as Organization;

        const changes: OrgChanges = {};
        if (patch.name !== undefined && org.name !== current.name)
          changes.name = { from: current.name, to: org.name };
        if (patch.timezone !== undefined && org.timezone !== current.timezone)
          changes.timezone = { from: current.timezone, to: org.timezone };
        const from = current.defaultStationId ?? null;
        const to = org.defaultStationId ?? null;
        if (patch.defaultStationId !== undefined && to !== from)
          changes.defaultStationId = {
            from,
            to,
            fromName: await stationName(from),
            toName,
          };

        // The same entries the app records (#907 name, #935 default station),
        // committed with the change, attributed to the operator's user when
        // their session sub matches one.
        const audited = [
          changes.name && { field: "name", ...changes.name },
          changes.defaultStationId && {
            field: "defaultStationId",
            ...changes.defaultStationId,
          },
        ].filter(Boolean) as Record<string, unknown>[];
        if (audited.length > 0) {
          const [operatorUser] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.auth0Id, actor), isNull(users.deleted)))
            .limit(1);
          const now = Date.now();
          await tx.insert(auditLog).values(
            audited.map((metadata) => ({
              id: randomUUID(),
              created: now,
              createdBy: actor,
              updated: null,
              updatedBy: null,
              deleted: null,
              deletedBy: null,
              organizationId: id,
              userId: operatorUser?.id ?? actor,
              action: "org.update",
              targetType: "organization",
              targetId: id,
              outcome: "success",
              sourceIp: null,
              userAgent: null,
              metadata: { ...metadata, via: "portalai" },
            }))
          );
        }

        return { org, changes };
      });
    },

    async setTier(id, tierSlug, actor) {
      const [tier] = await db
        .select({ slug: tiers.slug })
        .from(tiers)
        .where(and(eq(tiers.slug, tierSlug), isNull(tiers.deleted)))
        .limit(1);
      if (!tier) throw new AdminNotFoundError(`Tier "${tierSlug}" not found`);

      const current = await this.getOrg(id);
      await db
        .update(organizations)
        .set({ tier: tierSlug, updated: Date.now(), updatedBy: actor })
        .where(and(eq(organizations.id, id), isNull(organizations.deleted)));
      return { id, tier: tierSlug, previousTier: current.tier };
    },

    async softDeleteOrg(id, actor) {
      const [row] = await db
        .update(organizations)
        .set({ deleted: Date.now(), deletedBy: actor })
        .where(and(eq(organizations.id, id), isNull(organizations.deleted)))
        .returning({ id: organizations.id });
      if (!row) throw new AdminNotFoundError(`Organization ${id} not found`);
    },

    async addMember(orgId, userId, actor) {
      // Validate both ends live (clear 8s beat FK errors).
      await this.getOrg(orgId);
      const [targetUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deleted)))
        .limit(1);
      if (!targetUser) throw new AdminNotFoundError(`User ${userId} not found`);

      const [existing] = await db
        .select()
        .from(organizationUsers)
        .where(
          and(
            eq(organizationUsers.organizationId, orgId),
            eq(organizationUsers.userId, userId)
          )
        )
        .limit(1);

      if (existing && existing.deleted === null) {
        throw new AdminConflictError(
          `User ${userId} is already a member of ${orgId}`
        );
      }
      if (existing) {
        // Revive the soft-deleted membership rather than inserting a twin.
        // lastLogin is reset to 0 too (see the insert-branch note): `member
        // add` must NEVER change the user's current org, and a revived row
        // could otherwise carry a stale high lastLogin (e.g. from a prior
        // `member switch` into this org) that would hijack the selector.
        await db
          .update(organizationUsers)
          .set({
            deleted: null,
            deletedBy: null,
            lastLogin: 0,
            updated: Date.now(),
            updatedBy: actor,
          })
          .where(eq(organizationUsers.id, existing.id));
        return;
      }

      // lastLogin: 0 (NOT null) is deliberate. The app's current-org selector
      // is `ORDER BY last_login DESC LIMIT 1`, and Postgres sorts NULLS FIRST
      // under DESC — a null-lastLogin membership would silently hijack the
      // user's current org on next login. 0 sorts last, so `member add` never
      // changes which org the user lands in; only `member switch` (which bumps
      // lastLogin to now) does.
      const row = new OrganizationUserModelFactory()
        .create(actor)
        .update({ organizationId: orgId, userId, role: "member", lastLogin: 0 })
        .parse();
      await db.insert(organizationUsers).values(row as never);
    },

    async removeMember(orgId, userId, actor) {
      const [row] = await db
        .update(organizationUsers)
        .set({ deleted: Date.now(), deletedBy: actor })
        .where(
          and(
            eq(organizationUsers.organizationId, orgId),
            eq(organizationUsers.userId, userId),
            isNull(organizationUsers.deleted)
          )
        )
        .returning({ id: organizationUsers.id });
      if (!row) {
        throw new AdminNotFoundError(
          `User ${userId} is not a member of ${orgId}`
        );
      }
    },

    async switchMember(orgId, userId, actor) {
      const [row] = await db
        .update(organizationUsers)
        .set({ lastLogin: Date.now(), updated: Date.now(), updatedBy: actor })
        .where(
          and(
            eq(organizationUsers.organizationId, orgId),
            eq(organizationUsers.userId, userId),
            isNull(organizationUsers.deleted)
          )
        )
        .returning({ id: organizationUsers.id });
      if (!row) {
        throw new AdminNotFoundError(
          `User ${userId} is not a member of ${orgId}`
        );
      }
    },

    close: onClose,
  };
}

/** Store over a live connection string (the CLI's runtime path). */
export function createDbAdminStore(connectionString: string): AdminStore {
  const client = postgres(connectionString, { max: 2 });
  const db = drizzle(client);
  return createAdminStore(db, async () => {
    await client.end({ timeout: 5 });
  });
}
