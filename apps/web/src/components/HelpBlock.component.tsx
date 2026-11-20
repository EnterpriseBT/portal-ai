import React from "react";

import { Box, Stack, Typography } from "@portalai/core/ui";
import MuiLink from "@mui/material/Link";

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
 */
export const HelpBlockUI: React.FC<HelpBlockUIProps> = ({
  content,
  linkComponent = "a",
}) => (
  <Box
    component="section"
    aria-label="Help"
    data-testid="help-block"
    sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
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
            <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
              {entry.title}
            </Typography>
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
          <Typography variant="caption" color="text.secondary">
            Related
          </Typography>
          <Stack component="ul" sx={{ m: 0, pl: 2.5 }} spacing={0.25}>
            {content.candidates.map((c) => (
              <li key={`${c.surface}:${c.slug}`}>
                <MuiLink component={linkComponent} href={c.url} variant="body2">
                  {c.title}
                </MuiLink>
              </li>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  </Box>
);
