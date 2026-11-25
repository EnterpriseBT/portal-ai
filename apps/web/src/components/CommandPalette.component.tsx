import React from "react";

import {
  CircularProgress,
  Combobox,
  Kbd,
  Modal,
  Typography,
} from "@portalai/core/ui";

import { CommandPaletteOptionUI } from "./CommandPaletteOption.component";
import {
  paletteOptions,
  paletteStatusText,
  type PaletteGroup,
  type PaletteOption,
} from "../utils/launcher-items.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

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
        inputRef={inputRef}
      />
    </Modal>
  );
};
