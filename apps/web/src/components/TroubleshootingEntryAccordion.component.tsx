import React from "react";

import { Box, Stack, Typography } from "@portalai/core/ui";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Link from "@mui/material/Link";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import {
  contentEntrySlug,
  type TroubleshootingEntry,
} from "@portalai/core/content";

export interface TroubleshootingEntryAccordionUIProps {
  entry: TroubleshootingEntry;
  /** Controlled: the consumer owns which entries are open (#365). */
  expanded: boolean;
  onToggle: () => void;
  /** A related FAQ question or glossary term was chosen. */
  onSelectRelated?: (surface: "faq" | "glossary", title: string) => void;
  /** Ref registry keyed by slug, so a `#troubleshooting-entry-<slug>` anchor can scroll here. */
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}

/**
 * One troubleshooting entry (#1049): the symptom as its title, then why it
 * happens and what to do, each under a fixed label. The labels match the
 * body `platform_help` quotes, so the page and the portal read the same.
 */
export const TroubleshootingEntryAccordionUI: React.FC<
  TroubleshootingEntryAccordionUIProps
> = ({ entry, expanded, onToggle, onSelectRelated, registerEntryRef }) => {
  const slug = contentEntrySlug(entry.symptom);
  const id = `troubleshooting-entry-${slug}`;

  return (
    <Accordion
      data-testid={id}
      expanded={expanded}
      onChange={onToggle}
      ref={(el: HTMLElement | null) => {
        registerEntryRef?.(slug, el);
      }}
    >
      {/* Named by the symptom, so two open entries aren't identical regions
          (#799, axe landmark-unique). */}
      <AccordionSummary
        id={`${id}-header`}
        aria-controls={`${id}-content`}
        expandIcon={<ExpandMoreIcon />}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {entry.symptom}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", fontWeight: 600 }}
            >
              Why it happens
            </Typography>
            <Typography variant="body2">{entry.cause}</Typography>
          </Box>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", fontWeight: 600 }}
            >
              What to do
            </Typography>
            <Typography variant="body2">{entry.fix}</Typography>
          </Box>

          {entry.related && entry.related.length > 0 && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", fontWeight: 600 }}
              >
                Related
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {entry.related.map((r) => (
                  <Link
                    key={`${r.surface}:${r.title}`}
                    component="button"
                    type="button"
                    variant="body2"
                    onClick={() => onSelectRelated?.(r.surface, r.title)}
                  >
                    {r.title}
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
