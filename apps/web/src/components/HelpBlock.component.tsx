import React from "react";

import { Stack, Typography } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";

import type { HelpBlockContent } from "@portalai/core/contracts";

export interface HelpBlockUIProps {
  content: HelpBlockContent;
  /** The router link (`RouterLink` in the app); core-free components can't
   *  import the router (#794). Defaults to a plain anchor. */
  linkComponent?: React.ElementType;
}

const SURFACE_LABEL: Record<
  HelpBlockContent["entries"][number]["surface"],
  string
> = {
  faq: "FAQ",
  glossary: "Glossary",
  troubleshooting: "Troubleshooting",
};

/**
 * `platform_help`'s answer in the portal (#1049): the matched help entries,
 * each body quoted exactly as the help content holds it, as plain text (no
 * markdown, so nothing reshapes it), with a link into Help. The assistant's
 * own words sit outside this block. A question nothing matched shows that no
 * entry covers it, and a way into Help.
 *
 * Each entry leads with a small surface chip and its title, then the body and
 * an arrow link; entries are separated by dividers, and related entries are
 * link chips rather than a list. Each block is a region named after its
 * question (or, for a bare call, its first entry), so several in one
 * conversation are told apart.
 */
export const HelpBlockUI: React.FC<HelpBlockUIProps> = ({
  content,
  linkComponent = "a",
}) => {
  const name = content.query || content.entries[0]?.title || "Help";

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={`Help: ${name}`}
      data-testid="help-block"
      sx={{ p: 2 }}
    >
      <Stack spacing={2} divider={<Divider flexItem />}>
        {content.noMatch ? (
          <Stack spacing={0.5}>
            <Typography variant="body2">No help entry covers this.</Typography>
            <MuiLink
              component={linkComponent}
              href={content.helpUrl}
              variant="body2"
            >
              Browse Help <span aria-hidden="true">→</span>
            </MuiLink>
          </Stack>
        ) : (
          content.entries.map((entry) => (
            <Stack
              key={`${entry.surface}:${entry.slug}`}
              spacing={1}
              data-testid={`help-block-entry-${entry.surface}-${entry.slug}`}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={SURFACE_LABEL[entry.surface]}
                  size="small"
                  variant="outlined"
                />
                <Typography variant="subtitle2" component="p">
                  {entry.title}
                </Typography>
              </Stack>
              {/* pre-line keeps the entry's own line breaks, as the Help
                  page's accordions do. */}
              <Typography
                variant="body2"
                component="p"
                color="text.secondary"
                data-testid="help-block-body"
                sx={{ whiteSpace: "pre-line" }}
              >
                {entry.body}
              </Typography>
              <MuiLink
                component={linkComponent}
                href={entry.url}
                variant="body2"
                aria-label={`Open “${entry.title}” in Help`}
              >
                Open in Help <span aria-hidden="true">→</span>
              </MuiLink>
            </Stack>
          ))
        )}

        {content.candidates.length > 0 && (
          <Stack spacing={1} data-testid="help-block-related">
            <Typography variant="caption" color="text.secondary" component="p">
              Related
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
              {content.candidates.map((c) => (
                <Chip
                  key={`${c.surface}:${c.slug}`}
                  label={c.title}
                  size="small"
                  variant="outlined"
                  clickable
                  component={linkComponent}
                  href={c.url}
                />
              ))}
            </Stack>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};
