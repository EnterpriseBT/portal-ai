import React from "react";
import ReactMarkdown from "react-markdown";

import { Box, Stack, Typography } from "@portalai/core/ui";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import {
  GLOSSARY_CATEGORY_LABELS,
  type GlossaryEntry,
} from "../utils/glossary.util";

/**
 * Render a glossary `definition` or `example` string with markdown
 * support — backticks become inline `<code>` spans, fenced ``` blocks
 * become monospace `<pre>` blocks. Paragraph styling matches the
 * surrounding MUI Typography body2 so prose entries look unchanged.
 */
const GlossaryProse: React.FC<{ source: string; italic?: boolean }> = ({
  source,
  italic = false,
}) => (
  <Box
    sx={{
      ...(italic ? { fontStyle: "italic" } : {}),
      // Tighten the default markdown spacing so a one-paragraph
      // definition reads like a single Typography.body2 line.
      "& p": {
        margin: 0,
        font: "inherit",
        fontSize: "0.875rem",
        lineHeight: 1.43,
      },
      "& p + p": { marginTop: "0.75em" },
      "& code": {
        fontFamily: "monospace",
        fontSize: "0.85em",
        backgroundColor: "action.hover",
        borderRadius: 0.5,
        padding: "0.1em 0.35em",
      },
      "& pre": {
        fontFamily: "monospace",
        fontSize: "0.8125rem",
        backgroundColor: "action.hover",
        borderRadius: 1,
        padding: 1,
        margin: "0.5em 0 0",
        overflowX: "auto",
        whiteSpace: "pre",
      },
      "& pre code": {
        backgroundColor: "transparent",
        padding: 0,
        fontSize: "inherit",
      },
      "& strong": { fontStyle: "normal" },
    }}
  >
    <ReactMarkdown>{source}</ReactMarkdown>
  </Box>
);

export interface GlossaryListProps {
  entries: GlossaryEntry[];
  onSelectTerm?: (term: string) => void;
  /** Slug of the entry whose accordion should be expanded by default. */
  expandedTerm?: string | null;
  /** Optional ref-attaching function so consumers can scroll to a specific entry. */
  registerEntryRef?: (term: string, el: HTMLElement | null) => void;
}

const slugifyTerm = (term: string): string =>
  term.toLowerCase().replace(/\s+/g, "-");

export const GlossaryList: React.FC<GlossaryListProps> = ({
  entries,
  onSelectTerm,
  expandedTerm,
  registerEntryRef,
}) => {
  if (entries.length === 0) {
    return (
      <Box data-testid="glossary-empty" sx={{ py: 4, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No glossary entries match your search.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={1}>
      {entries.map((entry) => {
        const slug = slugifyTerm(entry.term);
        const expanded = expandedTerm
          ? expandedTerm.toLowerCase() === entry.term.toLowerCase()
          : undefined;

        return (
          <Accordion
            key={slug}
            data-testid={`glossary-entry-${slug}`}
            ref={(el: HTMLElement | null) => {
              registerEntryRef?.(entry.term, el);
            }}
            defaultExpanded={expanded}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ width: "100%" }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {entry.term}
                </Typography>
                <Chip
                  size="small"
                  label={GLOSSARY_CATEGORY_LABELS[entry.category]}
                  data-testid={`glossary-category-chip-${slug}`}
                />
              </Stack>
            </AccordionSummary>

            <AccordionDetails>
              <Stack spacing={1.5}>
                <GlossaryProse source={entry.definition} />

                {entry.example && (
                  <Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", fontWeight: 600 }}
                    >
                      Example
                    </Typography>
                    <GlossaryProse source={entry.example} italic />
                  </Box>
                )}

                {entry.relatedTerms && entry.relatedTerms.length > 0 && (
                  <Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", fontWeight: 600 }}
                    >
                      Related
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {entry.relatedTerms.map((related) => (
                        <Link
                          key={related}
                          component="button"
                          type="button"
                          variant="body2"
                          onClick={() => onSelectTerm?.(related)}
                          sx={{ cursor: "pointer" }}
                        >
                          {related}
                        </Link>
                      ))}
                    </Stack>
                  </Box>
                )}

                {entry.pageRoute && (
                  <Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", fontWeight: 600 }}
                    >
                      Found on
                    </Typography>
                    <Typography variant="body2">{entry.pageRoute}</Typography>
                  </Box>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Stack>
  );
};
