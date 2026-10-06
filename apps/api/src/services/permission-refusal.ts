/**
 * #711: what a permission refusal says. Policies govern permissions; roles and
 * groups only package policies, and a custom policy, a group or a direct grant
 * can hand anyone any permission. So a refusal names the **permission** that's
 * missing ("You don't have permission to manage billing."), never a role.
 *
 * Kept apart from `permission-set.ts`, whose NUL-byte sentinels make text tools
 * treat it as binary.
 */

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type {
  PermissionAction,
  PermissionObject,
} from "./permission.service.js";

export const PERMISSION_DENIED_FALLBACK =
  "You don't have permission to perform this action.";

/** The non-`resource.*` actions, each a fixed phrase. */
const ACTION_PHRASES: Partial<Record<PermissionAction, string>> = {
  "billing.manage": "manage billing",
  "org.delete": "delete the organization",
  "org.audit.read": "view the audit log",
  "member.role.assign": "change members' roles",
  "member.invite": "invite members",
  "member.remove": "remove members",
};

/** What a resource type is called, one and many. */
const TYPE_LABELS: Record<string, { one: string; many: string }> = {
  station: { one: "station", many: "stations" },
  pin: { one: "pinned result", many: "pinned results" },
  curated_view: { one: "view", many: "views" },
  portal: { one: "portal", many: "portals" },
  entity: { one: "entity", many: "entities" },
  entity_record: { one: "record", many: "records" },
  field_mapping: { one: "field mapping", many: "field mappings" },
  connector_instance: { one: "connector", many: "connectors" },
  connector_definition: {
    one: "connector definition",
    many: "connector definitions",
  },
  entity_group: { one: "entity group", many: "entity groups" },
  tag: { one: "tag", many: "tags" },
  column_definition: { one: "column definition", many: "column definitions" },
  job: { one: "job", many: "jobs" },
  toolpack: { one: "toolpack", many: "toolpacks" },
};

function resourcePhrase(
  action: PermissionAction,
  object: PermissionObject | undefined
): string | null {
  if (action === "resource.view") return "view this page";
  const label = object && TYPE_LABELS[object.type];
  if (!label) return null;
  const one = Boolean(object.id);
  switch (action) {
    case "resource.read":
      return one ? `view this ${label.one}` : `view ${label.many}`;
    case "resource.write":
      // An id-less write serves both creates and entity-wide actions (e.g.
      // re-validate), so it doesn't claim "create".
      return one ? `edit this ${label.one}` : `create or edit ${label.many}`;
    case "resource.delete":
      return one ? `delete this ${label.one}` : `delete ${label.many}`;
    case "resource.share":
      return one ? `share this ${label.one}` : `share ${label.many}`;
    default:
      return null;
  }
}

/** "You don't have permission to <phrase>." for a checked action. */
export function permissionRefusalMessage(
  action: PermissionAction,
  object?: PermissionObject
): string {
  const phrase = ACTION_PHRASES[action] ?? resourcePhrase(action, object);
  return phrase
    ? `You don't have permission to ${phrase}.`
    : PERMISSION_DENIED_FALLBACK;
}

/** The 403 every permission refusal throws. */
export function permissionDenied(
  action: PermissionAction,
  object?: PermissionObject
): ApiError {
  return new ApiError(
    403,
    ApiCode.PERMISSION_DENIED,
    permissionRefusalMessage(action, object)
  );
}
