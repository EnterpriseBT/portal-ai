import React from "react";

import { Stack } from "@portalai/core/ui";

import {
  contentEntrySlug,
  type TroubleshootingEntry,
} from "@portalai/core/content";
import { TroubleshootingEntryAccordionUI } from "./TroubleshootingEntryAccordion.component";

export interface TroubleshootingListUIProps {
  entries: TroubleshootingEntry[];
  /** Slugs whose accordion is open. Controlled — the consumer owns it (#365). */
  expandedSlugs: ReadonlySet<string>;
  onToggleEntry: (slug: string) => void;
  onSelectRelated?: (surface: "faq" | "glossary", title: string) => void;
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}

/** Help's Troubleshooting tab (#1049): one accordion per entry. */
export const TroubleshootingListUI: React.FC<TroubleshootingListUIProps> = ({
  entries,
  expandedSlugs,
  onToggleEntry,
  onSelectRelated,
  registerEntryRef,
}) => (
  <Stack spacing={1}>
    {entries.map((entry) => {
      const slug = contentEntrySlug(entry.symptom);
      return (
        <TroubleshootingEntryAccordionUI
          key={slug}
          entry={entry}
          expanded={expandedSlugs.has(slug)}
          onToggle={() => onToggleEntry(slug)}
          onSelectRelated={onSelectRelated}
          registerEntryRef={registerEntryRef}
        />
      );
    })}
  </Stack>
);
