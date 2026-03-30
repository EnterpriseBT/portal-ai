import React from "react";

import { Stack, Typography } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

interface PortalCardUIProps {
  id: string;
  name: string;
  created: number;
  onClick: (id: string) => void;
  onDelete: (id: string) => void;
}

export const PortalCardUI: React.FC<PortalCardUIProps> = ({
  id,
  name,
  created,
  onClick,
  onDelete,
}) => (
  <Card variant="outlined">
    <Stack
      direction={{ xs: "column", sm: "row" }}
      alignItems={{ xs: "stretch", sm: "center" }}
    >
      <CardActionArea
        onClick={() => onClick(id)}
        sx={{ flex: 1, minWidth: 0 }}
      >
        <CardContent sx={{ "&:last-child": { pb: 2 } }}>
          <Typography variant="subtitle1" noWrap>
            {name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: { xs: "block", sm: "none" }, mt: 0.5 }}
          >
            {DateFactory.relativeTime(created)}
          </Typography>
        </CardContent>
      </CardActionArea>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: { xs: "none", sm: "block" }, flexShrink: 0, mr: 1 }}
      >
        {DateFactory.relativeTime(created)}
      </Typography>
      <Tooltip title="Delete portal">
        <IconButton
          size="small"
          color="error"
          onClick={() => onDelete(id)}
          data-testid={`delete-portal-${id}`}
          sx={{
            mr: 1,
            alignSelf: { xs: "flex-end", sm: "center" },
            mb: { xs: 1, sm: 0 },
          }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  </Card>
);
