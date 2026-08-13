import React from "react";

import { Box, Stack, Typography } from "@portalai/core/ui";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Link from "@mui/material/Link";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { contentEntrySlug, type FAQEntry } from "@portalai/core/content";

export interface FAQEntryAccordionProps {
  entry: FAQEntry;
  /** Controlled: the consumer owns which entries are open (#365). */
  expanded: boolean;
  onToggle: () => void;
  onSelectTerm?: (term: string) => void;
  /** Ref registry keyed by slug, so a `#faq-entry-<slug>` anchor can scroll here. */
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}

/**
 * One FAQ question. Lifted out of `FAQList.component.tsx` when #365 gave it
 * expansion state and a scroll ref — a JSX fragment worth naming gets its own
 * file (CLAUDE.md → Component File Policy), and it was an inline helper the
 * policy already disallowed.
 */
export const FAQEntryAccordion: React.FC<FAQEntryAccordionProps> = ({
  entry,
  expanded,
  onToggle,
  onSelectTerm,
  registerEntryRef,
}) => {
  const slug = contentEntrySlug(entry.question);

  return (
    <Accordion
      data-testid={`faq-entry-${slug}`}
      expanded={expanded}
      onChange={onToggle}
      ref={(el: HTMLElement | null) => {
        registerEntryRef?.(slug, el);
      }}
    >
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
