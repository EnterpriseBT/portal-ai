import React from "react";

import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import LockOutlined from "@mui/icons-material/LockOutlined";
import MemoryOutlined from "@mui/icons-material/MemoryOutlined";
import ViewQuiltOutlined from "@mui/icons-material/ViewQuiltOutlined";

export type AttachmentChipKind = "connector" | "view";

export interface AttachmentChipUIProps {
  kind: AttachmentChipKind;
  label: string;
  /** Whether the viewer can read the attached object (#674). */
  canRead: boolean;
}

const NO_ACCESS: Record<AttachmentChipKind, string> = {
  connector: "You don't have access to this connector",
  view: "You don't have access to this view",
};

/**
 * One station attachment, a connector or a curated view (#674). An attachment
 * the viewer can't read is still shown, with its real name, as an
 * error-outlined chip with a lock and a tooltip. It is never clickable: the
 * viewer can see it's there without being able to open it.
 */
export const AttachmentChipUI: React.FC<AttachmentChipUIProps> = ({
  kind,
  label,
  canRead,
}) => {
  if (canRead) {
    const Icon = kind === "connector" ? MemoryOutlined : ViewQuiltOutlined;
    return (
      <Chip
        icon={<Icon fontSize="small" />}
        label={label}
        size="small"
        variant="outlined"
        color="primary"
      />
    );
  }
  return (
    <Tooltip title={NO_ACCESS[kind]}>
      <Chip
        icon={<LockOutlined fontSize="small" />}
        label={label}
        size="small"
        variant="outlined"
        color="error"
        aria-label={`${label}: ${NO_ACCESS[kind]}`}
        data-testid="attachment-chip-no-access"
      />
    </Tooltip>
  );
};
