import React from "react";

import type { Toolpack, ToolpackTool } from "@portalai/core/contracts";
import { Box, Modal, Stack, Typography } from "@portalai/core/ui";

import { HighlightedCode } from "./HighlightedCode.component";
import { UpgradeLink } from "./UpgradeLink.component";
import { UNENTITLED_PACK_TOOLTIP } from "../utils/tool-packs.util";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";

export interface ToolpackMetadataModalUIProps {
  toolpack: Toolpack | null;
  open: boolean;
  onClose: () => void;
  /**
   * Whether the org's plan includes this pack (#284). `false` renders a
   * notice naming the limit plus the upgrade path, so a badged row does not
   * dead-end in a modal that reads as fully available. The tool list still
   * renders — the modal documents what the pack *does*. Defaults to `true`.
   */
  entitled?: boolean;
}

/**
 * Read-only modal that renders a toolpack's name, description, and
 * full list of tools — including each tool's parameter schema and
 * any registered examples. Renders sparsely if the metadata is sparse.
 */
export const ToolpackMetadataModalUI: React.FC<
  ToolpackMetadataModalUIProps
> = ({ toolpack, open, onClose, entitled = true }) => {
  return (
    <Modal
      open={open && toolpack !== null}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="toolpack-metadata-title"
      title={
        toolpack && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography
              id="toolpack-metadata-title"
              variant="h6"
              component="span"
            >
              {toolpack.name}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label={toolpack.kind === "builtin" ? "Built-in" : "Custom"}
            />
          </Stack>
        )
      }
    >
      {toolpack && (
        <>
          <Stack spacing={3}>
            {!entitled && (
              <Alert severity="info" data-testid="toolpack-plan-notice">
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="baseline"
                  sx={{ flexWrap: "wrap" }}
                >
                  <span>{UNENTITLED_PACK_TOOLTIP}</span>
                  <UpgradeLink />
                </Stack>
              </Alert>
            )}
            {toolpack.description && (
              <Typography variant="body2" color="text.secondary">
                {toolpack.description}
              </Typography>
            )}

            {toolpack.kind === "custom" && (
              <Box
                sx={{
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  p: 2,
                }}
              >
                <Stack spacing={1}>
                  <Typography variant="overline" color="text.secondary">
                    Endpoints
                  </Typography>
                  <EndpointRow label="Schema" url={toolpack.endpoints.schema} />
                  <EndpointRow
                    label="Runtime"
                    url={toolpack.endpoints.runtime}
                  />
                  {toolpack.endpoints.metadata && (
                    <EndpointRow
                      label="Metadata"
                      url={toolpack.endpoints.metadata}
                    />
                  )}
                  <Typography variant="caption" color="text.secondary">
                    Auth headers:{" "}
                    {toolpack.authHeadersStatus.has ? "set" : "not set"}
                    {" • "}
                    Last refreshed:{" "}
                    {new Date(toolpack.schemaFetchedAt).toLocaleString()}
                  </Typography>
                </Stack>
              </Box>
            )}

            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary">
                Tools ({toolpack.tools.length})
              </Typography>
              {toolpack.tools.map((tool) => (
                <ToolSection key={tool.name} tool={tool} />
              ))}
            </Stack>
          </Stack>
        </>
      )}
    </Modal>
  );
};

const EndpointRow: React.FC<{ label: string; url: string }> = ({
  label,
  url,
}) => (
  <Stack direction="row" spacing={1} alignItems="baseline">
    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70 }}>
      {label}
    </Typography>
    <Typography
      variant="body2"
      sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
    >
      {url}
    </Typography>
  </Stack>
);

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
          <Box sx={{ mt: 0.5 }}>
            <HighlightedCode
              code={JSON.stringify(tool.parameterSchema, null, 2)}
              language="json"
              data-testid="toolpack-tool-schema"
            />
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
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 0.5 }}
                      >
                        Input
                      </Typography>
                      <HighlightedCode
                        code={JSON.stringify(ex.input, null, 2)}
                        language="json"
                      />
                    </Box>
                  )}
                  {ex.output !== undefined && (
                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 0.5 }}
                      >
                        Output
                      </Typography>
                      <HighlightedCode
                        code={JSON.stringify(ex.output, null, 2)}
                        language="json"
                      />
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
