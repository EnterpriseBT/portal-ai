import React from "react";

import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import {
  AttachmentChipUI,
  type AttachmentChipKind,
} from "./AttachmentChip.component";

export interface StationAttachmentListItem {
  id: string;
  label: string;
  canRead: boolean;
}

export interface StationAttachmentListUIProps {
  kind: AttachmentChipKind;
  items: StationAttachmentListItem[];
}

/**
 * One attachment row's value on a station surface (#674): every attachment as
 * an `AttachmentChipUI`, locked where the viewer can't read it, or `—` when
 * there are none. The row stays visible when empty; the station's attachment
 * alert says why.
 */
export const StationAttachmentListUI: React.FC<
  StationAttachmentListUIProps
> = ({ kind, items }) => {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
      {items.map((item) => (
        <AttachmentChipUI
          key={item.id}
          kind={kind}
          label={item.label}
          canRead={item.canRead}
        />
      ))}
    </Stack>
  );
};
