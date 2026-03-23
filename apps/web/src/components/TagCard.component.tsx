import React from "react";

import type { EntityTag } from "@portalai/core/models";
import { Box, Stack, Typography } from "@portalai/core/ui";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

export interface TagCardUIProps {
  tag: EntityTag;
  onEdit: (tag: EntityTag) => void;
  onDelete: (tag: EntityTag) => void;
}

export const TagCardUI: React.FC<TagCardUIProps> = ({
  tag,
  onEdit,
  onDelete,
}) => (
  <Card variant="outlined">
    <CardContent sx={{ "&:last-child": { pb: 2 } }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={1.5}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {tag.color && (
            <Box
              sx={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                backgroundColor: tag.color,
                flexShrink: 0,
              }}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {tag.name}
            </Typography>
            {tag.description && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {tag.description}
              </Typography>
            )}
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
          <IconButton
            size="small"
            onClick={() => onEdit(tag)}
            aria-label="edit"
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onDelete(tag)}
            aria-label="delete"
            color="error"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
    </CardContent>
  </Card>
);
