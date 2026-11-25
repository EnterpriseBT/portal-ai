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

import {
  and,
  desc,
  eq,
  isNull,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
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

export type OrgPatch = Partial<Pick<Organization, "name" | "timezone">>;

/** #936: what an org update actually changed (fields whose value moved). */
export interface OrgChanges {
  name?: { from: string; to: string };
  timezone?: { from: string; to: string };
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
   *  with the org row locked; a changed name records the app's `org.update`
   *  entry. Returns what changed. */
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
  /** #1035: whether a live org carries `demo create`'s marker;
   *  absent/soft-deleted → ADMIN_NOT_FOUND. */
  isDemoOrg(id: string): Promise<boolean>;
  /** A live tier by slug → ADMIN_NOT_FOUND otherwise. */
  getTier(slug: string): Promise<{ slug: string }>;
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
/**
 * A case-insensitive "contains" that matches `term` literally (#1039): `\`,
 * `%` and `_` are escaped and the escape character is stated, so
 * `--search _` finds names containing an underscore instead of every org.
 * Mirrors apps/api's `ilikeContains` (utils/filter-sql.util.ts), which this
 * package can't import; `like-search.guard.test.ts` there scans both.
 */
function ilikeContains(column: SQLWrapper, term: string): SQL {
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${column} ILIKE ${"%" + escaped + "%"} ESCAPE '\\'`;
}

export function createAdminStore(
  db: PostgresJsDatabase,
  onClose: () => Promise<void> = async () => {}
): AdminStore {
  return {
    async listOrgs(opts) {
      const conditions = [isNull(organizations.deleted)];
      if (opts.search) {
        conditions.push(ilikeContains(organizations.name, opts.search));
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

        // What would actually change; a no-op writes nothing, so the row
        // isn't stamped as edited by an operator who changed nothing.
        const changes: OrgChanges = {};
        if (patch.name !== undefined && patch.name !== current.name)
          changes.name = { from: current.name, to: patch.name };
        if (patch.timezone !== undefined && patch.timezone !== current.timezone)
          changes.timezone = { from: current.timezone, to: patch.timezone };
        if (Object.keys(changes).length === 0)
          return { org: current as Organization, changes };

        const [row] = await tx
          .update(organizations)
          .set({ ...patch, updated: Date.now(), updatedBy: actor })
          .where(eq(organizations.id, id))
          .returning();
        const org = row as Organization;

        // The same entry the app records (#907 name), committed with the
        // change, attributed to the operator's user when their session sub
        // matches one.
        const audited = [
          changes.name && { field: "name", ...changes.name },
        ].filter(Boolean) as Record<string, unknown>[];
        if (audited.length > 0) {
          const [operatorUser] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.auth0Id, actor), isNull(users.deleted)))
            .limit(1);
          const now = Date.now();
          // Actor and creator are the same principal, as the app records them.
          const principal = operatorUser?.id ?? actor;
          await tx.insert(auditLog).values(
            audited.map((metadata) => ({
              id: randomUUID(),
              created: now,
              createdBy: principal,
              updated: null,
              updatedBy: null,
              deleted: null,
              deletedBy: null,
              organizationId: id,
              userId: principal,
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

    async getTier(slug) {
      const [tier] = await db
        .select({ slug: tiers.slug })
        .from(tiers)
        .where(and(eq(tiers.slug, slug), isNull(tiers.deleted)))
        .limit(1);
      if (!tier) throw new AdminNotFoundError(`Tier "${slug}" not found`);
      return tier;
    },

    async setTier(id, tierSlug, actor) {
      await this.getTier(tierSlug);

      const current = await this.getOrg(id);
      await db
        .update(organizations)
        .set({ tier: tierSlug, updated: Date.now(), updatedBy: actor })
        .where(and(eq(organizations.id, id), isNull(organizations.deleted)));
      return { id, tier: tierSlug, previousTier: current.tier };
    },

    async isDemoOrg(id) {
      // Raw on purpose: `is_demo` isn't in the mirror (see tables.ts), so
      // only this read needs an env migrated to #1035.
      const [row] = await db
        .select({ isDemo: sql<boolean>`is_demo` })
        .from(organizations)
        .where(and(eq(organizations.id, id), isNull(organizations.deleted)))
        .limit(1);
      if (!row) throw new AdminNotFoundError(`Organization ${id} not found`);
      return row.isDemo === true;
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
