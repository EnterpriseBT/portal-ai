import { drizzle } from "drizzle-orm/postgres-js";

import type { TagTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { generateId } from "./application.util.js";

type Db = ReturnType<typeof drizzle>;

/**
 * #1070: one object of every taggable type, created by `createdBy` in
 * `orgId`. `name` labels each one (station, pin and connector names, entity
 * and view labels), so a list test can search for it.
 */
export async function seedTagTargets(
  db: Db,
  orgId: string,
  createdBy: string,
  name = "Object"
): Promise<Record<TagTargetType, string>> {
  const base = () => ({
    id: generateId(),
    created: Date.now(),
    createdBy,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });
  const connDef = {
    ...base(),
    slug: `tag-target-${generateId().slice(0, 8)}`,
    display: "Test Connector",
    category: "crm",
    authType: "oauth2",
    configSchema: {},
    capabilityFlags: { sync: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
  };
  await db.insert(schema.connectorDefinitions).values(connDef as never);
  const instance = {
    ...base(),
    connectorDefinitionId: connDef.id,
    organizationId: orgId,
    name,
    status: "active",
    config: {},
    credentials: null,
    // Entity deletes need the connector's write capability on.
    enabledCapabilityFlags: { read: true, write: true },
  };
  await db.insert(schema.connectorInstances).values(instance as never);
  const entity = {
    ...base(),
    organizationId: orgId,
    connectorInstanceId: instance.id,
    key: `e_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: name,
  };
  await db.insert(schema.connectorEntities).values(entity as never);
  const station = { ...base(), organizationId: orgId, name };
  await db.insert(schema.stations).values(station as never);
  const pin = {
    ...base(),
    organizationId: orgId,
    stationId: station.id,
    portalId: null,
    name,
    type: "text",
    content: {},
    definerPrincipalType: "user",
    definerPrincipalId: createdBy,
  };
  await db.insert(schema.portalResults).values(pin as never);
  const view = {
    ...base(),
    organizationId: orgId,
    connectorEntityId: entity.id,
    key: `v_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: name,
    description: null,
    filter: null,
  };
  await db.insert(schema.curatedViews).values(view as never);
  return {
    entity: entity.id,
    station: station.id,
    pin: pin.id,
    connector_instance: instance.id,
    curated_view: view.id,
  };
}

/** A tag in `orgId`, created by `createdBy`. */
export async function seedTag(
  db: Db,
  orgId: string,
  createdBy: string,
  name = `tag-${generateId().slice(0, 8)}`
): Promise<string> {
  const tag = {
    id: generateId(),
    organizationId: orgId,
    name,
    color: null,
    description: null,
    created: Date.now(),
    createdBy,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
  await db.insert(schema.entityTags).values(tag as never);
  return tag.id;
}
