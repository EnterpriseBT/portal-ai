import React from "react";

import type { Toolpack, ToolpackTool } from "@portalai/core/contracts";
import { Box, Stack, Typography } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";

export interface ToolpackMetadataModalUIProps {
  toolpack: Toolpack | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Read-only modal that renders a toolpack's name, description, and
 * full list of tools — including each tool's parameter schema and
 * any registered examples. Renders sparsely if the metadata is sparse.
 */
export const ToolpackMetadataModalUI: React.FC<ToolpackMetadataModalUIProps> = ({
  toolpack,
  open,
  onClose,
}) => {
  return (
    <Dialog
      open={open && toolpack !== null}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="toolpack-metadata-title"
    >
      {toolpack && (
        <>
          <DialogTitle id="toolpack-metadata-title" sx={{ pr: 6 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" component="span">
                {toolpack.name}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={toolpack.kind === "builtin" ? "Built-in" : "Custom"}
              />
            </Stack>
            <IconButton
              aria-label="Close metadata"
              onClick={onClose}
              sx={{
                position: "absolute",
                right: 8,
                top: 8,
              }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={3}>
              <Typography variant="body2" color="text.secondary">
                {toolpack.description}
              </Typography>

              <Stack spacing={2}>
                <Typography variant="overline" color="text.secondary">
                  Tools ({toolpack.tools.length})
                </Typography>
                {toolpack.tools.map((tool) => (
                  <ToolSection key={tool.name} tool={tool} />
                ))}
              </Stack>
            </Stack>
          </DialogContent>
        </>
      )}
    </Dialog>
  );
};

const ToolSection: React.FC<{ tool: ToolpackTool }> = ({ tool }) => {
  return (
    <Box
      sx={{
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
        p: 2,
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography
            variant="subtitle2"
            sx={{ fontFamily: "monospace" }}
            data-testid="toolpack-tool-name"
          >
            {tool.name}
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {tool.description}
        </Typography>

        <Box>
          <Typography variant="caption" color="text.secondary">
            Parameters
          </Typography>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              backgroundColor: (theme) => theme.palette.action.hover,
              borderRadius: 0.5,
              p: 1.5,
              overflow: "auto",
              m: 0,
              mt: 0.5,
            }}
            data-testid="toolpack-tool-schema"
          >
            {JSON.stringify(tool.parameterSchema, null, 2)}
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary">
            Examples
          </Typography>
          {tool.examples && tool.examples.length > 0 ? (
            <Stack spacing={1.5} sx={{ mt: 0.5 }}>
              {tool.examples.map((ex, i) => (
                <Box
                  key={i}
                  sx={{
                    border: (theme) => `1px dashed ${theme.palette.divider}`,
                    borderRadius: 0.5,
                    p: 1.5,
                  }}
                >
                  {ex.title && (
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {ex.title}
                    </Typography>
                  )}
                  {ex.description && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 1 }}
                    >
                      {ex.description}
                    </Typography>
                  )}
                  {ex.input !== undefined && (
                    <Box sx={{ mb: ex.output !== undefined ? 1 : 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        Input
                      </Typography>
                      <Box
                        component="pre"
                        sx={{
                          fontSize: 12,
                          backgroundColor: (theme) =>
                            theme.palette.action.hover,
                          borderRadius: 0.5,
                          p: 1,
                          m: 0,
                          mt: 0.5,
                          overflow: "auto",
                        }}
                      >
                        {JSON.stringify(ex.input, null, 2)}
                      </Box>
                    </Box>
                  )}
                  {ex.output !== undefined && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Output
                      </Typography>
                      <Box
                        component="pre"
                        sx={{
                          fontSize: 12,
                          backgroundColor: (theme) =>
                            theme.palette.action.hover,
                          borderRadius: 0.5,
                          p: 1,
                          m: 0,
                          mt: 0.5,
                          overflow: "auto",
                        }}
                      >
                        {JSON.stringify(ex.output, null, 2)}
                      </Box>
                    </Box>
                  )}
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontStyle: "italic", mt: 0.5 }}
            >
              No examples provided.
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  );
};
