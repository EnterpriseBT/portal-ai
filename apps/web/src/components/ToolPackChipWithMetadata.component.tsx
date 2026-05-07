import React, { useMemo, useState } from "react";

import {
  BUILTIN_TOOLPACK_BY_SLUG,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";
import type { Toolpack } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { ToolPackChip } from "./ToolPackChip.component";
import { ToolpackMetadataModalUI } from "./ToolpackMetadataModal.component";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Resolve a toolpack reference to a `Toolpack` record.
 *
 * - Built-in slugs synthesize from the in-memory registry — works
 *   even before the list query has loaded.
 * - `org:<uuid>` refs look up against the supplied list payload.
 * - Anything else returns `null` (the chip stays non-clickable).
 */
export function resolveToolpack(
  pack: string,
  listToolpacks: Toolpack[]
): Toolpack | null {
  if (isBuiltinToolpackSlug(pack)) {
    const reg = BUILTIN_TOOLPACK_BY_SLUG[pack];
    return {
      id: `builtin:${reg.slug}`,
      kind: "builtin",
      slug: reg.slug,
      name: reg.name,
      description: reg.description,
      iconSlug: reg.iconSlug,
      tools: reg.tools,
    };
  }
  if (pack.startsWith("org:")) {
    const id = pack.slice("org:".length);
    return (
      listToolpacks.find((t) => t.kind === "custom" && t.id === id) ?? null
    );
  }
  return null;
}

// ── Pure UI ─────────────────────────────────────────────────────────

export interface ToolPackChipWithMetadataUIProps {
  /** Toolpack reference: a built-in slug or `org:<uuid>`. */
  pack: string;
  /** Resolved `Toolpack` record, or `null` while loading / unresolved. */
  toolpack: Toolpack | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Renders a `ToolPackChip` and a metadata modal. The chip is
 * clickable only when `toolpack` is non-null; clicking calls
 * `onOpen`. When `open` is true the modal renders with the supplied
 * toolpack content.
 */
export const ToolPackChipWithMetadataUI: React.FC<
  ToolPackChipWithMetadataUIProps
> = ({ pack, toolpack, open, onOpen, onClose }) => {
  const clickable = toolpack !== null;
  return (
    <>
      <ToolPackChip
        pack={pack}
        label={toolpack?.kind === "custom" ? toolpack.name : undefined}
        onClick={clickable ? onOpen : undefined}
        sx={clickable ? { cursor: "pointer" } : undefined}
      />
      <ToolpackMetadataModalUI
        toolpack={toolpack}
        open={open}
        onClose={onClose}
      />
    </>
  );
};

// ── Container ───────────────────────────────────────────────────────

export interface ToolPackChipWithMetadataProps {
  pack: string;
}

/**
 * Loads the merged toolpacks list (deduped via React Query),
 * resolves the supplied pack reference, and wires up modal-open
 * state. One mount per chip — the list query is shared across them.
 */
export const ToolPackChipWithMetadata: React.FC<
  ToolPackChipWithMetadataProps
> = ({ pack }) => {
  const [open, setOpen] = useState(false);
  const listResult = sdk.toolpacks.list();
  const listData = listResult.data;

  const toolpack = useMemo(
    () => resolveToolpack(pack, (listData?.toolpacks ?? []) as Toolpack[]),
    [pack, listData]
  );

  return (
    <ToolPackChipWithMetadataUI
      pack={pack}
      toolpack={toolpack}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    />
  );
};
