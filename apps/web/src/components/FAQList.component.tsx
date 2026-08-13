import React from "react";

import { Box, PageSection, Stack, Typography } from "@portalai/core/ui";

import {
  FAQ_CATEGORY_LABELS,
  FAQCategory,
  contentEntrySlug,
  type FAQEntry,
} from "@portalai/core/content";
import { FAQEntryAccordion } from "./FAQEntryAccordion.component";

export interface FAQListProps {
  entries: FAQEntry[];
  /** When true, render section headers grouping entries by category. */
  groupByCategory?: boolean;
  onSelectTerm?: (term: string) => void;
  /** Slugs whose accordion is open. Controlled — the consumer owns it (#365). */
  expandedSlugs: ReadonlySet<string>;
  onToggleEntry: (slug: string) => void;
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}

const groupEntries = (
  entries: FAQEntry[]
): Array<[FAQCategory, FAQEntry[]]> => {
  const seenOrder: FAQCategory[] = [];
  const buckets = new Map<FAQCategory, FAQEntry[]>();
  for (const entry of entries) {
    if (!buckets.has(entry.category)) {
      buckets.set(entry.category, []);
      seenOrder.push(entry.category);
    }
    buckets.get(entry.category)!.push(entry);
  }
  return seenOrder.map((cat) => [cat, buckets.get(cat)!]);
};

export const FAQList: React.FC<FAQListProps> = ({
  entries,
  groupByCategory = false,
  onSelectTerm,
  expandedSlugs,
  onToggleEntry,
  registerEntryRef,
}) => {
  const renderEntry = (entry: FAQEntry) => {
    const slug = contentEntrySlug(entry.question);
    return (
      <FAQEntryAccordion
        key={slug}
        entry={entry}
        expanded={expandedSlugs.has(slug)}
        onToggle={() => onToggleEntry(slug)}
        onSelectTerm={onSelectTerm}
        registerEntryRef={registerEntryRef}
      />
    );
  };

  if (entries.length === 0) {
    return (
      <Box data-testid="faq-empty" sx={{ py: 4, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No FAQ entries match your search.
        </Typography>
      </Box>
    );
  }

  if (!groupByCategory) {
    return <Stack spacing={1}>{entries.map(renderEntry)}</Stack>;
  }

  const grouped = groupEntries(entries);

  return (
    <Stack spacing={3}>
      {grouped.map(([category, categoryEntries]) => (
        <PageSection
          key={category}
          title={FAQ_CATEGORY_LABELS[category]}
          variant="divider"
          data-testid={`faq-category-header-${category}`}
        >
          <Stack spacing={1}>{categoryEntries.map(renderEntry)}</Stack>
        </PageSection>
      ))}
    </Stack>
  );
};
