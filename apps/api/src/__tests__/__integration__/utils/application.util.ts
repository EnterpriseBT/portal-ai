/**
 * Shared test utilities for integration tests.
 *
 * Provides factory functions for creating test data and
 * seed/teardown helpers for the user → organization → org-user
 * chain required by the getApplicationMetadata middleware.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { UUIDv4Factory } from "@portalai/core/utils";
import * as schema from "../../../db/schema/index.js";

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
  stationTools,
  stationInstances,
  portalResults,
  portalMessages,
  portals,
  stations,
  organizationTools,
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

  const orgUser = createOrganizationUser(org.id, user.id);
  await db.insert(organizationUsers).values(orgUser as never);

  return {
    userId: user.id,
    organizationId: org.id,
    organizationUserId: orgUser.id,
  };
}

/**
 * Tear down all user/organization data in FK-safe order.
 *
 * Deletes from child tables first to respect foreign key constraints.
 * Includes all tables that reference users or organizations.
 */
export async function teardownOrg(db: Db): Promise<void> {
  await db.delete(stationTools);
  await db.delete(stationInstances);
  await db.delete(portalResults);
  await db.delete(portalMessages);
  await db.delete(portals);
  await db.delete(organizationTools);
  await db.delete(stations);
  await db.delete(entityGroupMembers);
  await db.delete(entityGroups);
  await db.delete(entityTagAssignments);
  await db.delete(entityTags);
  await db.delete(entityRecords);
  await db.delete(fieldMappings);
  await db.delete(connectorEntities);
  await db.delete(columnDefinitions);
  await db.delete(jobs);
  await db.delete(fileUploads);
  await db.delete(connectorInstanceLayoutPlans);
  await db.delete(connectorInstances);
  await db.delete(connectorDefinitions);
  await db.delete(organizationUsers);
  await db.delete(organizations);
  await db.delete(users);
}
