import React from "react";

import { Box, Stack, Typography } from "@portalai/core/ui";
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
 * Each block is a region named after its question (or, for a bare call, its
 * first entry), so several in one conversation are told apart.
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
      <Stack spacing={2}>
        {content.noMatch ? (
          <Stack spacing={0.5}>
            <Typography variant="body2">No help entry covers this.</Typography>
            <MuiLink
              component={linkComponent}
              href={content.helpUrl}
              variant="body2"
            >
              Browse Help
            </MuiLink>
          </Stack>
        ) : (
          content.entries.map((entry) => (
            <Stack
              key={`${entry.surface}:${entry.slug}`}
              spacing={0.5}
              data-testid={`help-block-entry-${entry.surface}-${entry.slug}`}
            >
              <Typography variant="caption" color="text.secondary">
                {SURFACE_LABEL[entry.surface]}
              </Typography>
              <Typography variant="subtitle2" component="p">
                {entry.title}
              </Typography>
              {/* pre-line keeps the entry's own line breaks, as the Help
                  page's accordions do. */}
              <Typography
                variant="body2"
                component="p"
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
                Open in Help
              </MuiLink>
            </Stack>
          ))
        )}

        {content.candidates.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" component="p">
              Related
            </Typography>
            <Stack component="ul" spacing={0.25}>
              {content.candidates.map((c) => (
                <li key={`${c.surface}:${c.slug}`}>
                  <MuiLink
                    component={linkComponent}
                    href={c.url}
                    variant="body2"
                  >
                    {c.title}
                  </MuiLink>
                </li>
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
};
