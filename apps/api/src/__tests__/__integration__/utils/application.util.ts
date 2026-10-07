/**
 * Shared test utilities for integration tests.
 *
 * Provides factory functions for creating test data and
 * seed/teardown helpers for the user → organization → org-user
 * chain required by the getApplicationMetadata middleware.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { UUIDv4Factory } from "@portalai/core/utils";
import {
  PermissionStatementModelFactory,
  PolicyAttachmentModelFactory,
  PolicyModelFactory,
  type PermissionResourceType,
  type PermissionVerb,
} from "@portalai/core/models";
import * as schema from "../../../db/schema/index.js";
import { DbService } from "../../../services/db.service.js";
import { ApplicationService } from "../../../services/application.service.js";
import { SeedService } from "../../../services/seed.service.js";

const {
  users,
  organizations,
  organizationUsers,
  connectorInstances,
  connectorDefinitions,
  connectorInstanceLayoutPlans,
  fileUploads,
  jobs,
  fieldMappings,
  connectorEntities,
  columnDefinitions,
  entityRecords,
  entityTagAssignments,
  entityTags,
  entityGroupMembers,
  entityGroups,
  stationToolpacks,
  organizationToolpacks,
  stationInstances,
  wideTableColumns,
  apiEndpointConfigs,
  portalResults,
  portalMessages,
  portals,
  stations,
  usage,
  toolUsageLedger,
  auditLog,
  invitations,
  permissionStatements,
  policyAttachments,
  permissionGrants,
  permissionPolicies,
  roles,
  userRole,
  groups,
  userGroup,
  curatedViews,
  curatedViewFieldMappings,
  stationViews,
} = schema;

type Db = ReturnType<typeof drizzle>;

const idFactory = new UUIDv4Factory();

/** Generate a unique v4-style UUID. */
export const generateId = () => idFactory.generate();

const now = Date.now();

// ── Factory functions ────────────────────────────────────────────────

export function createUser(
  auth0Id: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    auth0Id,
    email: `user-${generateId()}@example.com`,
    name: "Test User",
    lastLogin: now,
    lastLoginSession: null,
    picture: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

export function createOrganization(
  ownerUserId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    name: "Test Organization",
    timezone: "UTC",
    ownerUserId,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

export function createOrganizationUser(
  organizationId: string,
  userId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    userId,
    role: "member",
    lastLogin: now,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

// ── Seed / Teardown ──────────────────────────────────────────────────

export interface SeedResult {
  userId: string;
  organizationId: string;
  organizationUserId: string;
}

/**
 * #598: seed the RBAC system policies (owner/admin/member roles + policies)
 * for a test org so `PermissionService.check` resolves. Production seeds these
 * at provisioning / via the 0102 backfill; a test that builds an org by hand
 * must call this or every guard fails closed. Idempotent.
 */
export async function seedRbacForOrg(
  db: Db,
  organizationId: string
): Promise<void> {
  await new SeedService().seedRbacSystemPolicies(organizationId, db as never);
}

/**
 * Seed a user, organization, and org-user link so that the
 * `getApplicationMetadata` middleware can resolve the request context.
 *
 * @param db       Drizzle database client
 * @param auth0Id  Auth0 subject identifier for the test user
 * @returns IDs of the created records
 */
export async function seedUserAndOrg(
  db: Db,
  auth0Id: string
): Promise<SeedResult> {
  const user = createUser(auth0Id);
  await db.insert(users).values(user as never);

  const org = createOrganization(user.id);
  await db.insert(organizations).values(org as never);

  // The seeded user is the org's owner (org.ownerUserId === user.id), so the
  // membership carries the owner role (#576).
  const orgUser = createOrganizationUser(org.id, user.id, { role: "owner" });
  await db.insert(organizationUsers).values(orgUser as never);

  // #598: seed the RBAC system policies so PermissionService.check resolves
  // (mirrors production provisioning; without it every guard fails closed).
  await new SeedService().seedRbacSystemPolicies(org.id, db as never);

  return {
    userId: user.id,
    organizationId: org.id,
    organizationUserId: orgUser.id,
  };
}

export interface TenancyFixture {
  orgId: string;
  ownerId: string;
  memberId: string;
  otherOrgId: string;
  otherOwnerId: string;
}

/**
 * #685: the three identities every authorization test needs: an org owner,
 * a plain member of the same org (role `member`), and the owner of a second,
 * unrelated org. Both orgs get the RBAC system policies. Pair it with a mocked
 * `jwtCheck` whose `sub` the test flips between the three auth0 ids.
 */
export async function seedTenancyFixture(
  db: Db,
  subs: { owner: string; member: string; otherOwner: string }
): Promise<TenancyFixture> {
  const owner = await seedUserAndOrg(db, subs.owner);
  const member = createUser(subs.member);
  await db.insert(users).values(member as never);
  await db.insert(organizationUsers).values(
    createOrganizationUser(owner.organizationId, member.id, {
      role: "member",
    }) as never
  );
  const other = await seedUserAndOrg(db, subs.otherOwner);
  return {
    orgId: owner.organizationId,
    ownerId: owner.userId,
    memberId: member.id,
    otherOrgId: other.organizationId,
    otherOwnerId: other.userId,
  };
}

/**
 * #710: attach a custom policy directly to `userId` (a user-principal
 * attachment) with one class-level statement on `verb resourceType`.
 */
async function attachUserPolicy(
  db: Db,
  args: {
    organizationId: string;
    userId: string;
    effect: "allow" | "deny";
    verb: PermissionVerb;
    resourceType: PermissionResourceType;
  }
): Promise<void> {
  const policy = new PolicyModelFactory()
    .create("system")
    .update({
      organizationId: args.organizationId,
      name: `${args.effect} ${args.verb} ${args.resourceType} ${generateId()}`,
      kind: "custom",
      description: null,
    })
    .parse();
  await db.insert(permissionPolicies).values(policy as never);
  await db.insert(permissionStatements).values(
    new PermissionStatementModelFactory()
      .create("system")
      .update({
        organizationId: args.organizationId,
        policyId: policy.id,
        effect: args.effect,
        verb: args.verb,
        resourceType: args.resourceType,
        resourceId: null,
        condition: null,
      })
      .parse() as never
  );
  await db.insert(policyAttachments).values(
    new PolicyAttachmentModelFactory()
      .create("system")
      .update({
        organizationId: args.organizationId,
        policyId: policy.id,
        principalType: "user",
        principalId: args.userId,
      })
      .parse() as never
  );
}

/**
 * #710: deny `verb resourceType` to `userId` outright. A deny beats every
 * allow in the caller's union, so the caller loses the permission whatever
 * their role grants.
 */
export async function denyForUser(
  db: Db,
  args: {
    organizationId: string;
    userId: string;
    verb: PermissionVerb;
    resourceType: PermissionResourceType;
  }
): Promise<void> {
  await attachUserPolicy(db, { ...args, effect: "deny" });
}

/**
 * #710: allow `verb resourceType` to `userId` through a policy attached to
 * the user. Member removal doesn't tombstone such an attachment, so it
 * outlives the membership.
 */
export async function allowForUser(
  db: Db,
  args: {
    organizationId: string;
    userId: string;
    verb: PermissionVerb;
    resourceType: PermissionResourceType;
  }
): Promise<void> {
  await attachUserPolicy(db, { ...args, effect: "allow" });
}

/**
 * Tear down all user/organization data in FK-safe order.
 *
 * Deletes from child tables first to respect foreign key constraints.
 * Includes all tables that reference users or organizations.
 */
export async function teardownOrg(db: Db): Promise<void> {
  // #599: curated-view tables are leaf-most (FK → curated_views, stations,
  // connector_entities, field_mappings, organizations) — drain before the
  // rows they reference.
  await db.delete(stationViews);
  await db.delete(curatedViewFieldMappings);
  await db.delete(curatedViews);
  await db.delete(stationToolpacks);
  await db.delete(organizationToolpacks);
  await db.delete(stationInstances);
  await db.delete(portalResults);
  await db.delete(portalMessages);
  await db.delete(portals);
  await db.delete(stations);
  await db.delete(entityGroupMembers);
  await db.delete(entityGroups);
  await db.delete(entityTagAssignments);
  await db.delete(entityTags);
  await db.delete(entityRecords);
  await db.delete(wideTableColumns);
  await db.delete(fieldMappings);
  await db.delete(apiEndpointConfigs);
  await db.delete(connectorEntities);
  await db.delete(columnDefinitions);
  await db.delete(jobs);
  await db.delete(fileUploads);
  await db.delete(connectorInstanceLayoutPlans);
  await db.delete(connectorInstances);
  await db.delete(connectorDefinitions);
  await db.delete(usage);
  await db.delete(toolUsageLedger);
  // #575: audit_log FK-references organizations and its append-only trigger
  // blocks a plain DELETE — purge it (flagged) before the org rows it points at.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.audit_retention_purge = 'on'`);
    await tx.delete(auditLog);
  });
  await db.delete(invitations); // #584: FK → organizations + users
  // #598: RBAC engine — statements/attachments FK policies + organizations;
  // policies + roles + groups FK organizations. Delete before the org rows they
  // point at (#622: user_group → groups → org, so drain memberships first).
  await db.delete(userGroup);
  await db.delete(groups);
  await db.delete(userRole);
  await db.delete(permissionGrants);
  await db.delete(permissionStatements);
  await db.delete(policyAttachments);
  await db.delete(permissionPolicies);
  await db.delete(roles);
  await db.delete(organizationUsers);
  await db.delete(organizations);
  await db.delete(users);
}

/**
 * Create the given user row, then provision their personal owner-org — the
 * test-setup convenience that the removed `ApplicationService.setupOrganization`
 * used to provide (#583). Built from the public provisioning core
 * (`users.create` + `provisionOrganizationFor`) rather than a resurrected
 * service method: `setupOrganization` had no non-test caller once the webhook
 * moved to `ensureProvisioned`, and its create-user+provision role belongs in a
 * test helper, not on the service. Preserves the caller-supplied `id` and
 * returns the same `{ user, organization, organizationUser }` shape callers
 * relied on. First-login idempotency/concurrency is covered directly by the
 * `ensureProvisioned` integration tests.
 */
export async function provisionTestOrg(
  owner: Record<string, unknown> & { id: string; auth0Id: string }
) {
  const user = await DbService.repository.users.create(owner as never);
  const provisioned = await ApplicationService.provisionOrganizationFor(
    user.id
  );
  return { user, ...provisioned };
}

/**
 * #599: attach a default (unrestricted) curated view to a station — the cutover
 * replacement for a `station_instances` link on the read path. Creates a
 * `curated_views` row (no projection rows = all columns, null whereClause) and a
 * `station_views` attachment; when `grantToUserId` is set, also seeds the member
 * read grants a session needs (`read curated_view:<id>` + the composed
 * `read field_mapping in_curated_view:<id>` FK grant). Returns the view id.
 */
export async function attachCuratedView(
  db: Db,
  args: {
    stationId: string;
    organizationId: string;
    connectorEntityId: string;
    key: string;
    label: string;
    createdBy: string;
    grantToUserId?: string;
    filter?: import("@portalai/core/contracts").FilterGroup | null;
  }
): Promise<string> {
  const now = Date.now();
  const base = {
    created: now,
    createdBy: args.createdBy,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
  const viewId = generateId();
  await db.insert(curatedViews).values({
    ...base,
    id: viewId,
    organizationId: args.organizationId,
    connectorEntityId: args.connectorEntityId,
    key: args.key,
    label: args.label,
    description: null,
    filter: args.filter ?? null,
  } as never);
  await db.insert(stationViews).values({
    ...base,
    id: generateId(),
    organizationId: args.organizationId,
    stationId: args.stationId,
    curatedViewId: viewId,
  } as never);
  if (args.grantToUserId) {
    await db.insert(permissionGrants).values([
      {
        ...base,
        id: generateId(),
        organizationId: args.organizationId,
        principalType: "user",
        principalId: args.grantToUserId,
        effect: "allow",
        verb: "read",
        resourceType: "curated_view",
        resourceId: viewId,
        condition: null,
        conditionParam: null,
      },
      {
        ...base,
        id: generateId(),
        organizationId: args.organizationId,
        principalType: "user",
        principalId: args.grantToUserId,
        effect: "allow",
        verb: "read",
        resourceType: "field_mapping",
        resourceId: null,
        condition: "in_curated_view",
        conditionParam: viewId,
      },
    ] as never);
  }
  return viewId;
}
