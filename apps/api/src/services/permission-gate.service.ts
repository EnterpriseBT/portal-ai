import {
  OBJECT_CONTAINERS,
  isContainedType,
  type PartType,
  type PermissionResourceType,
  type ToolAuthorization,
} from "@portalai/core/models";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { RbacObjectResolver } from "./rbac-object-resolver.js";
import {
  ParentAccessService,
  type ParentRefusal,
} from "./parent-access.service.js";
import { resourceTypeLabel } from "./permission-refusal.js";
import { valuesAtPath } from "./lock-gate.service.js";
import type { PermissionSet } from "./permission-set.js";
import type { PermissionAction } from "./permission.service.js";
import type { GateableTool } from "./cost-gate.service.js";

/**
 * Per-caller, per-object tool-authorization gate (#629). The agent is a direct
 * extension of the user: it may do exactly what the user's roles, grants, and
 * group memberships permit, and any disallowed write **surfaces** to the user
 * rather than crashing the turn.
 *
 * `wrapWithPermissionGate` decorates every tool's `execute` in place (mirroring
 * `wrapWithCostGate`, applied *outside* it so a denied call never reaches cost
 * admission). Two paths converge on the same typed refusal:
 *
 *  - **pre-flight** for descriptor-carrying tools, one check per mode:
 *      - `create` — the new rows are caller-owned, so it checks
 *        `resource.write` on the type *with `createdBy` = the caller*; a
 *        member's `created_by_caller` write permits their own creates.
 *      - `single` / `batch` — resolves each target's `createdBy` (via
 *        {@link RbacObjectResolver}) and checks per object (batches are bounded
 *        ≤ 100 by the tool schema, so this is O(items), not O(table)).
 *  - **catch** — any `ApiError(403)` thrown inside `execute` (e.g. an
 *    `rbac_management` tool's own service gate) is converted to the same
 *    refusal.
 *
 * #829, objects and parts:
 *  - `parts` — records and field mappings have no permission of their own,
 *    so the tool needs write on every owning entity: the ids its
 *    `objectPaths` name (creates, whole-entity scans), or the stored owner of
 *    every part id it names (updates, deletes; never taken from input). A
 *    transform's source (`readPaths`) must be readable.
 *  - a `create` on a contained type (an entity) also needs write on every
 *    container its `containerPaths` name, and a `delete` on one needs write
 *    on each stored container (the directory rule; editing needs neither).
 * An unreadable entity or connector answers `TOOL_TARGET_NOT_FOUND`, a
 * read-only one `TOOL_PERMISSION_DENIED`, and the whole call is refused
 * before anything runs.
 *
 * Fail-**closed**: a resolution error (unlike the cost gate's fail-open) denies.
 * The check is O(1) in permission queries per invocation — the caller's
 * `PermissionSet` is resolved once per session and every `can` is a pure
 * in-memory evaluation; no mode issues a per-row permission query.
 */

/** A typed refusal returned *as a tool result* (never a throw), so the agent
 *  relays it. Mirrors the cost gate's `Denial.result` shape. */
export function permissionDenied(message: string): {
  error: { code: ApiCode; message: string };
} {
  return { error: { code: ApiCode.TOOL_PERMISSION_DENIED, message } };
}

/** #829: a typed "not found" result for a parent the caller can't see. */
export function targetNotFound(message: string): {
  error: { code: ApiCode; message: string };
} {
  return { error: { code: ApiCode.TOOL_TARGET_NOT_FOUND, message } };
}

/** The tool result for a refusal on an owning entity or a container. */
function refusalResult(
  parentType: PermissionResourceType,
  refusal: ParentRefusal
) {
  const label = resourceTypeLabel(parentType);
  return refusal.reason === "not_found"
    ? targetNotFound(
        `${label[0].toUpperCase()}${label.slice(1)} ${refusal.id} was not found.`
      )
    : permissionDenied(
        `You don't have permission to edit ${label} ${refusal.id}.`
      );
}

/** #835: a part type's label; parts aren't permission types (#829), so
 *  `resourceTypeLabel` doesn't know them. */
const PART_LABELS: Record<PartType, string> = {
  entity_record: "record",
  field_mapping: "field mapping",
};

/** #835: "<Label> <id> was not found." for a target the caller can't see. */
function notFoundResult(label: string, id: string) {
  return targetNotFound(
    `${label[0].toUpperCase()}${label.slice(1)} ${id} was not found.`
  );
}

function extractId(input: unknown, key?: string): string | undefined {
  if (!key || typeof input !== "object" || input === null) return undefined;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function extractItems(input: unknown, key?: string): unknown[] {
  if (!key || typeof input !== "object" || input === null) return [];
  const v = (input as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

export function wrapWithPermissionGate(
  tools: Record<string, GateableTool>,
  permissionSet: PermissionSet,
  ctx: { organizationId: string; userId: string },
  authFor: (toolName: string) => ToolAuthorization | undefined
): void {
  for (const [name, tool] of Object.entries(tools)) {
    const original = tool.execute;
    if (!original) continue;
    const auth = authFor(name);

    tool.execute = async (input: unknown, options: unknown) => {
      // Pre-flight: a descriptor-carrying tool is authorized per its mode.
      // Undescribed tools skip pre-flight (read/pure, and rbac_management tools
      // whose service self-gates — the catch below surfaces that 403).
      if (auth) {
        const action = `resource.${auth.verb}` as PermissionAction;
        const container = isContainedType(auth.resourceType)
          ? OBJECT_CONTAINERS[auth.resourceType].containerType
          : null;
        let allowed = false;
        let refused: ReturnType<typeof refusalResult> | null = null;
        /** #829: refuse unless every id passes `verb`; true when it did. */
        const allPass = async (
          type: PermissionResourceType,
          ids: string[],
          verb: "read" | "write"
        ) => {
          const refusal = await ParentAccessService.firstRefusal(
            permissionSet,
            ctx.organizationId,
            type,
            ids,
            verb
          );
          if (refusal) refused = refusalResult(type, refusal);
          return !refusal;
        };
        const fromPaths = (paths: string[] | undefined) =>
          (paths ?? []).flatMap((p) => valuesAtPath(input, p));
        /** The target ids a `single`/`batch` (or part-id `parts`) names;
         *  undefined marks a missing id, which denies. */
        const targetIds = (): (string | undefined)[] =>
          auth.targetIdArg != null
            ? [extractId(input, auth.targetIdArg)]
            : extractItems(input, auth.itemsArg).map((item) =>
                extractId(item, auth.idField)
              );
        /**
         * #835: each part's owning entity (and, for a mapping delete, its
         * counterpart's), or null to refuse. Every part is resolved before
         * any is refused, and then refused in input order whether it's
         * absent, another org's, or under an entity the caller can't read,
         * so the id a refusal names never tells those apart. A missing input
         * id is the generic denial.
         */
        const partOwners = async (
          partType: PartType,
          counterparts: boolean | undefined
        ): Promise<string[] | null> => {
          const label = PART_LABELS[partType];
          const parts: Array<{
            id: string;
            owner: string | null;
            counterpart: string | null;
          }> = [];
          for (const id of targetIds()) {
            if (!id) return null;
            const owner = await RbacObjectResolver.resolvePartOwner(
              ctx.organizationId,
              partType,
              id
            );
            const counterpart =
              owner && counterparts
                ? await RbacObjectResolver.resolveMappingCounterpartOwner(
                    ctx.organizationId,
                    id
                  )
                : null;
            parts.push({ id, owner, counterpart });
          }
          const unreadable = await ParentAccessService.unreadableIds(
            permissionSet,
            ctx.organizationId,
            "entity",
            parts.flatMap((p) =>
              [p.owner, p.counterpart].filter((e): e is string => !!e)
            )
          );
          for (const p of parts) {
            if (!p.owner || unreadable.has(p.owner)) {
              refused = notFoundResult(label, p.id);
              return null;
            }
            if (p.counterpart && unreadable.has(p.counterpart)) {
              // The mapping is visible; what it links to isn't.
              refused = targetNotFound(
                `The entity ${label} ${p.id} links to was not found.`
              );
              return null;
            }
          }
          return parts.flatMap((p) =>
            p.counterpart ? [p.owner!, p.counterpart] : [p.owner!]
          );
        };
        try {
          if (auth.mode === "parts") {
            // Owners from input paths, or from each stored part; any part
            // that doesn't resolve (missing, another org) denies.
            let owners: string[] | null = fromPaths(auth.objectPaths);
            if (auth.partType) {
              owners = await partOwners(auth.partType, auth.counterparts);
            }
            /** Write on every owning entity. By here each one is readable
             *  (#835), so a refusal can name it. */
            const ownersWritable = (ids: string[]) =>
              allPass("entity", ids, "write");
            const readIds = fromPaths(auth.readPaths);
            /** #832: every referenced object (a mapping's column
             *  definition) must be readable. */
            const referencesPass = async () => {
              for (const ref of auth.references ?? []) {
                const ids = fromPaths(ref.paths);
                if (
                  ids.length > 0 &&
                  !(await allPass(ref.resourceType, ids, "read"))
                ) {
                  return false;
                }
              }
              return true;
            };
            allowed =
              owners != null &&
              owners.length > 0 &&
              (readIds.length === 0 ||
                (await allPass("entity", readIds, "read"))) &&
              (await referencesPass()) &&
              (await ownersWritable(owners));
          } else if (auth.mode === "create") {
            // A contained type names its containers; none at all denies.
            const containerIds = fromPaths(auth.containerPaths);
            allowed =
              (!container ||
                (containerIds.length > 0 &&
                  (await allPass(container, containerIds, "write")))) &&
              // The new rows are owned by the caller, so check with
              // createdBy = the caller: a member's `created_by_caller`
              // write permits it.
              permissionSet.can(action, {
                type: auth.resourceType,
                createdBy: ctx.userId,
              });
          } else {
            // single, or batch (bounded ≤ 100 by tool schema): resolve every
            // target once; any unresolvable one denies the call.
            const ids = targetIds();
            const rows: Array<{ id: string; createdBy: string }> = [];
            const containerIds: string[] = [];
            for (const id of ids) {
              const row = id
                ? await RbacObjectResolver.resolveRow(
                    ctx.organizationId,
                    auth.resourceType,
                    id
                  )
                : null;
              // #835: unreadable == absent. Absent, another org's or
              // unreadable answer the same not-found, and before any verb
              // check, so no answer tells an existing id from a missing one.
              if (
                id &&
                (!row ||
                  !permissionSet.can("resource.read", {
                    type: auth.resourceType,
                    id,
                    createdBy: row.createdBy,
                  }))
              ) {
                refused = notFoundResult(
                  resourceTypeLabel(auth.resourceType),
                  id
                );
              }
              if (!id || !row || refused) {
                rows.length = 0;
                break;
              }
              rows.push({ id, createdBy: row.createdBy });
              if (row.containerId) containerIds.push(row.containerId);
            }
            // #829: deleting a contained object changes its container.
            const needsContainer = container != null && auth.verb === "delete";
            allowed =
              rows.length > 0 &&
              rows.length === ids.length &&
              (!needsContainer ||
                (containerIds.length === rows.length &&
                  (await allPass(container, containerIds, "write")))) &&
              rows.every((r) => {
                const ok = permissionSet.can(action, {
                  type: auth.resourceType,
                  id: r.id,
                  createdBy: r.createdBy,
                });
                if (!ok) {
                  refused ??= permissionDenied(
                    `You don't have permission to ${auth.verb} ${resourceTypeLabel(auth.resourceType)} ${r.id}.`
                  );
                }
                return ok;
              });
          }
        } catch {
          allowed = false; // fail-closed
          refused = null;
        }
        if (!allowed) {
          return (
            refused ??
            permissionDenied(
              `You don't have permission to ${auth.verb} this ${auth.resourceType}.`
            )
          );
        }
      }

      // Run the tool; a service-thrown 403 (e.g. an rbac_management tool's gate)
      // surfaces as the same typed refusal instead of an uncaught crash.
      try {
        return await original(input, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          return permissionDenied(err.message);
        }
        throw err;
      }
    };
  }
}
