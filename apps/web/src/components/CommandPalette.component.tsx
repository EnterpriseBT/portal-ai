import React from "react";

import { useRouterState } from "@tanstack/react-router";

import {
  CircularProgress,
  Combobox,
  IconName,
  Kbd,
  Modal,
  pendingGate,
  StatusMessage,
  Typography,
  type ActionGate,
} from "@portalai/core/ui";
import {
  SEARCH_RESULT_TYPES,
  type SearchResult,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";

import { CommandPaletteOptionUI } from "./CommandPaletteOption.component";
import { RouterLink } from "./RouterLink.component";
import {
  RESULT_GROUP_LABEL,
  paletteOptions,
  paletteStatusText,
  parsePaletteQuery,
  toLauncherItem,
  type PaletteAction,
  type PaletteEntry,
  type PaletteGroup,
  type PaletteOption,
} from "../utils/launcher-items.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { useDebouncedValue } from "../utils/use-debounced-value.util";
import { useRecentVisits } from "../utils/use-recent-visits.util";
import {
  RECENT_PORTALS_PARAMS,
  usePortalLauncherContext,
} from "../utils/portal-launcher.context";
import { useCreateGate } from "../utils/use-create-gate.util";

export interface CommandPaletteUIProps {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  /**
   * The rows to show, in order and already filtered: actions, favorites,
   * recent items, or search results labelled by type ("Tagged “finance”"
   * for a `#tag` query).
   */
  groups: PaletteGroup[];
  /** A search is in flight. */
  loading?: boolean;
  /**
   * #1076: a search that failed. Shown above the rows, which still offer
   * the actions and anything else that loaded.
   */
  errorMessage?: string | null;
  /**
   * Renders object rows as router links (the app's `RouterLink`); core
   * can't import the router. Required: a plain `<a>` would reload the app
   * on every pick.
   */
  linkComponent: React.ElementType;
}

const HINTS: [string, string][] = [
  ["↑↓", "move"],
  ["↵", "open"],
  ["#", "filter by tag"],
  ["esc", "close"],
];

/**
 * The command palette (#1122): a dialog holding the combobox shell, with
 * grouped rows and key hints. Rows that change the page are links; actions
 * are buttons in all but element. Escape closes it through `Modal`.
 *
 * It renders from props alone. Searching, recents, gates, the ⌘K listener
 * and closing after a navigation are #1076's wiring.
 */
export const CommandPaletteUI: React.FC<CommandPaletteUIProps> = ({
  open,
  onClose,
  query,
  onQueryChange,
  groups,
  loading = false,
  errorMessage = null,
  linkComponent,
}) => {
  const inputRef = useDialogAutoFocus<HTMLInputElement>(open);
  const options = paletteOptions(groups);
  const searching = query.trim() !== "";

  // The combobox pads its empty content and footer (the theme's job, not
  // this component's), so these are plain text.
  let emptyContent: React.ReactNode;
  if (loading) {
    emptyContent = (
      <>
        <CircularProgress size={12} aria-label="Loading results" /> Searching…
      </>
    );
  } else if (searching) {
    emptyContent = <>Nothing matches “{query}”.</>;
  } else {
    emptyContent = (
      <>
        Star stations, pinned results, views and connectors to reach them here,
        or type to search. Start with # to search by tag.
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label="Search and actions"
      maxWidth="sm"
      fullWidth
    >
      {errorMessage && <StatusMessage variant="error" message={errorMessage} />}
      <Combobox<PaletteOption>
        options={options}
        inputValue={query}
        onInputChange={onQueryChange}
        label="Search or run an action"
        placeholder="Search or run…"
        statusText={paletteStatusText(options.length, loading)}
        renderOption={(option) => (
          <CommandPaletteOptionUI entry={option.entry} />
        )}
        emptyContent={emptyContent}
        footer={HINTS.map(([key, action]) => (
          <Typography
            key={action}
            component="span"
            variant="caption"
            color="text.secondary"
          >
            <Kbd>{key}</Kbd> {action}
          </Typography>
        ))}
        linkComponent={linkComponent}
        // #1076: any picked link closes the palette, including one to the
        // page you're on, which changes no location.
        onFollowLink={onClose}
        inputRef={inputRef}
      />
    </Modal>
  );
};

// ── Container (#1076) ─────────────────────────────────────────────────

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const SEARCH_DEBOUNCE_MS = 200;
const RECENT_SHOWN = 8;
const TAG_SUGGESTIONS = 8;
const SEARCH_FAILED = "Couldn’t search. Try again.";

/**
 * The command palette, wired (#1076). Home shows Actions, Favorites, the
 * caller's 5 latest portals and other recent items; typing searches every
 * readable object type (one request per 200 ms pause, the superseded one
 * aborted); `#text` searches by tag, and `#` alone suggests tags. Actions
 * are gated like their page buttons, and Open Portal goes through the
 * shell's one launcher. Any navigation closes it, and closing it by any
 * path (Escape, ⌘K, a pick) clears the search.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
}) => {
  const [query, setQuery] = React.useState("");
  // Closing clears the search however it closes (the shell's ⌘K toggle
  // never calls onClose). Adjusted while rendering, React's pattern for
  // state that follows a prop.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setQuery("");
  }
  // A cleared search lands at once rather than after the debounce, so a
  // reopened palette never shows (or re-sends) the previous search.
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS, {
    immediate: query === "",
  });
  const parsed = parsePaletteQuery(debounced);
  const home = parsed.mode === "home";
  const tagMode = parsed.mode === "tag";

  // Any navigation closes the palette: a picked link, a create's
  // `?create=` link, or a portal the launcher opened.
  const href = useRouterState({ select: (s) => s.location.href });
  const lastHref = React.useRef(href);
  React.useEffect(() => {
    if (href === lastHref.current) return;
    lastHref.current = href;
    if (open) onClose();
  }, [href, open, onClose]);

  // ── Data, one query per mode, each only while the palette is open ──
  const favorites = sdk.search.query({}, { enabled: open && home });
  const { visits, prune } = useRecentVisits();
  const refs = visits.map((v) => `${v.type}:${v.id}`).join(",");
  const recent = sdk.search.query(
    { refs },
    { enabled: open && home && refs !== "" }
  );
  // The launcher's own query (same key), so the two share one request.
  const recentPortals = sdk.portals.list(RECENT_PORTALS_PARAMS, {
    enabled: open && home,
  });
  const results = sdk.search.query(
    { q: parsed.mode === "search" ? parsed.text : "" },
    { enabled: open && parsed.mode === "search" }
  );
  const tagged = sdk.search.query(
    { tag: tagMode ? parsed.text : "" },
    { enabled: open && tagMode && parsed.text !== "" }
  );
  const tagSuggestions = sdk.entityTags.list(
    {
      limit: TAG_SUGGESTIONS,
      offset: 0,
      sortBy: "name",
      sortOrder: "asc",
    },
    { enabled: open && tagMode && parsed.text === "" }
  );

  // A successful hydration prunes what the server no longer returns; a
  // failure (or the previous refs' placeholder) never does.
  const recentData =
    recent.isSuccess && !recent.isPlaceholderData ? recent.data : undefined;
  React.useEffect(() => {
    if (!recentData) return;
    prune(new Set(recentData.results.map((r) => `${r.type}:${r.id}`)));
  }, [recentData, prune]);
  // Recent shows in the stored order from whatever has loaded, the previous
  // refs' results included, so a new visit doesn't blank the group while
  // its refs load; the new item joins when they do.
  const hydrated = new Map(
    (recent.data?.results ?? []).map((r) => [`${r.type}:${r.id}`, r])
  );
  const recentResults =
    refs === ""
      ? []
      : visits.flatMap((v) => {
          const hit = hydrated.get(`${v.type}:${v.id}`);
          return hit ? [hit] : [];
        });

  // ── Actions ──
  const launcher = usePortalLauncherContext();
  const stationGate = useCreateGate(
    "station",
    "Ask for access to create stations"
  );
  const connectGate = useCreateGate(
    "connector_instance",
    "Ask for access to connect data"
  );
  const viewGate = useCreateGate(
    "curated_view",
    "Ask for access to create views"
  );
  const entityGate = useCreateGate(
    "entity",
    "Ask for access to create entities"
  );
  const tagGate = useCreateGate("tag", "Ask for access to create tags");

  // A launch already in flight (from here or the header) blocks another,
  // like the header's menu; permission is heard first.
  const launchGate: ActionGate =
    launcher.gate.kind === "allow" && launcher.pending
      ? pendingGate(true, "Starting…")
      : launcher.gate;
  const launchStations = [
    ...(launcher.station ? [launcher.station] : []),
    ...launcher.favoriteStations.filter((s) => s.id !== launcher.station?.id),
  ];
  const actions: PaletteAction[] = [
    ...launchStations.map(
      (station): PaletteAction => ({
        id: `new-portal:${station.id}`,
        label: `Open Portal in ${station.name}`,
        icon: IconName.Portal,
        gate: launchGate,
        onSelect: () => {
          onClose();
          launcher.launch(station.id);
        },
      })
    ),
    {
      id: "choose-station",
      label: "Open Portal: choose station…",
      icon: IconName.Portal,
      gate: launchGate,
      onSelect: () => {
        onClose();
        launcher.chooser.onOpen();
      },
    },
    {
      id: "new-station",
      label: "New station",
      href: "/stations?create=station",
      gate: stationGate,
    },
    {
      id: "import-file",
      label: "Import a file",
      href: "/connectors?create=file-upload",
      gate: connectGate,
    },
    {
      id: "new-view",
      label: "New view",
      href: "/views?create=view",
      gate: viewGate,
    },
    {
      id: "new-entity",
      label: "New entity",
      href: "/entities?create=entity",
      gate: entityGate,
    },
    {
      id: "new-tag",
      label: "New tag",
      href: "/tags?create=tag",
      gate: tagGate,
    },
  ];
  const actionEntries = (text: string): PaletteEntry[] =>
    actions
      .filter((a) => a.label.toLowerCase().includes(text.toLowerCase()))
      .map((a) => ({ kind: "action", ...a }));
  const items = (list: SearchResult[] | undefined): PaletteEntry[] =>
    (list ?? []).map((r) => ({ kind: "item", ...toLauncherItem(r) }));

  // ── Groups ──
  const groups: PaletteGroup[] = [];
  let loading = false;
  let errorMessage: string | null = null;
  if (home) {
    // The caller's latest portals, newest first, so an existing chat opens
    // in one step; other recent items follow, newest first.
    const recentPortalEntries = (recentPortals.data?.portals ?? []).map(
      (p): PaletteEntry => ({
        kind: "item",
        ...toLauncherItem({ type: "portal", id: p.id, name: p.name, tags: [] }),
      })
    );
    groups.push(
      { label: "Actions", entries: actionEntries("") },
      { label: "Favorites", entries: items(favorites.data?.results) },
      { label: "Recent portals", entries: recentPortalEntries },
      {
        label: "Recent",
        entries: items(recentResults.slice(0, RECENT_SHOWN)),
      }
    );
    loading = favorites.isLoading;
    // Any home group that failed says so, rather than just not showing.
    if (favorites.isError || recent.isError || recentPortals.isError) {
      errorMessage = "Couldn’t load everything here. Try again.";
    }
  } else if (parsed.mode === "search") {
    groups.push({ label: "Actions", entries: actionEntries(parsed.text) });
    for (const type of SEARCH_RESULT_TYPES) {
      groups.push({
        label: RESULT_GROUP_LABEL[type],
        entries: items(results.data?.results.filter((r) => r.type === type)),
      });
    }
    loading = results.isLoading;
    if (results.isError) errorMessage = SEARCH_FAILED;
  } else if (parsed.text === "") {
    groups.push({
      label: "Tags",
      entries: (tagSuggestions.data?.entityTags ?? []).map(
        (tag): PaletteEntry => ({
          kind: "action",
          id: `tag:${tag.id}`,
          label: `#${tag.name}`,
          onSelect: () => setQuery(`#${tag.name}`),
        })
      ),
    });
    loading = tagSuggestions.isLoading;
    if (tagSuggestions.isError) errorMessage = SEARCH_FAILED;
  } else {
    const matched = tagged.data?.matchedTags ?? [];
    groups.push({
      label:
        matched.length === 1
          ? `Tagged “${matched[0].name}”`
          : `Tagged “${parsed.text}…”`,
      entries: items(tagged.data?.results),
    });
    loading = tagged.isLoading;
    if (tagged.isError) errorMessage = SEARCH_FAILED;
  }

  return (
    <CommandPaletteUI
      open={open}
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      groups={groups.filter((g) => g.entries.length > 0)}
      loading={loading}
      errorMessage={errorMessage}
      linkComponent={RouterLink}
    />
  );
};
