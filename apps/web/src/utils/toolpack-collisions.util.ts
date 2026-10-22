import {
  BUILTIN_TOOLPACK_BY_SLUG,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";
import type { Toolpack } from "@portalai/core/contracts";

export interface ToolpackCollision {
  toolName: string;
  /** Display labels of the packs that each define this tool, sorted alphabetically. */
  ownerLabels: string[];
}

/**
 * Walk the user's selected pack refs and find tool names that
 * appear in more than one pack. Used by station dialogs to warn
 * about collisions before save.
 *
 * The runtime check in `tools.service.buildAnalyticsTools` is the
 * authoritative guard at session-build time; this helper just
 * surfaces the same detection earlier so users can fix it before
 * opening a portal.
 *
 * - Built-in slugs resolve from the in-memory registry.
 * - `org:<id>` refs look up against the supplied list payload.
 * - Unresolvable refs are skipped silently (the caller's slug
 *   validation handles those).
 */
export function detectToolpackCollisions(
  selectedRefs: string[],
  customs: Toolpack[]
): ToolpackCollision[] {
  // #645: a collision is two *definitions* of a name, not two packs. A
  // built-in tool shared by several packs (`member_list`) is one registry
  // object, so it counts once; a custom pack's same-named tool is another.
  const byTool = new Map<
    string,
    { definitions: Set<unknown>; owners: Set<string> }
  >();
  for (const ref of selectedRefs) {
    const { tools, label } = resolve(ref, customs);
    if (!tools) continue;
    for (const tool of tools) {
      const entry = byTool.get(tool.name) ?? {
        definitions: new Set(),
        owners: new Set(),
      };
      entry.definitions.add(tool);
      entry.owners.add(label);
      byTool.set(tool.name, entry);
    }
  }

  const collisions: ToolpackCollision[] = [];
  for (const [toolName, { definitions, owners }] of byTool.entries()) {
    if (definitions.size > 1) {
      collisions.push({ toolName, ownerLabels: [...owners].sort() });
    }
  }
  return collisions.sort((a, b) => a.toolName.localeCompare(b.toolName));
}

function resolve(
  ref: string,
  customs: Toolpack[]
): { tools: { name: string }[] | null; label: string } {
  if (isBuiltinToolpackSlug(ref)) {
    const reg = BUILTIN_TOOLPACK_BY_SLUG[ref];
    return { tools: reg.tools, label: reg.name };
  }
  if (ref.startsWith("org:")) {
    const id = ref.slice("org:".length);
    const pack = customs.find((t) => t.kind === "custom" && t.id === id);
    if (!pack) return { tools: null, label: ref };
    return { tools: pack.tools, label: pack.name };
  }
  return { tools: null, label: ref };
}
