import React from "react";

import { Box, PageSection, Stack, Typography } from "@portalai/core/ui";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Link from "@mui/material/Link";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import {
  FAQ_CATEGORY_LABELS,
  FAQCategory,
  type FAQEntry,
} from "../utils/faq.util";

export interface FAQListProps {
  entries: FAQEntry[];
  /** When true, render section headers grouping entries by category. */
  groupByCategory?: boolean;
  onSelectTerm?: (term: string) => void;
}

const slugifyQuestion = (question: string): string =>
  question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

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

const FAQEntryAccordion: React.FC<{
  entry: FAQEntry;
  onSelectTerm?: (term: string) => void;
}> = ({ entry, onSelectTerm }) => {
  const slug = slugifyQuestion(entry.question);

  return (
    <Accordion data-testid={`faq-entry-${slug}`}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {entry.question}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
            {entry.answer}
          </Typography>

          {entry.relatedGlossaryTerms &&
            entry.relatedGlossaryTerms.length > 0 && (
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", fontWeight: 600 }}
                >
                  Related terms
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {entry.relatedGlossaryTerms.map((term) => (
                    <Link
                      key={term}
                      component="button"
                      type="button"
                      variant="body2"
                      onClick={() => onSelectTerm?.(term)}
                      sx={{ cursor: "pointer" }}
                    >
                      {term}
                    </Link>
                  ))}
                </Stack>
              </Box>
            )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
};

export const FAQList: React.FC<FAQListProps> = ({
  entries,
  groupByCategory = false,
  onSelectTerm,
}) => {
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
    return (
      <Stack spacing={1}>
        {entries.map((entry) => (
          <FAQEntryAccordion
            key={slugifyQuestion(entry.question)}
            entry={entry}
            onSelectTerm={onSelectTerm}
          />
        ))}
      </Stack>
    );
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
          <Stack spacing={1}>
            {categoryEntries.map((entry) => (
              <FAQEntryAccordion
                key={slugifyQuestion(entry.question)}
                entry={entry}
                onSelectTerm={onSelectTerm}
              />
            ))}
          </Stack>
        </PageSection>
      ))}
    </Stack>
  );
};
