import { Stack, Typography } from "@portalai/core/ui";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Tooltip from "@mui/material/Tooltip";

export type ConnectorInstanceFlag = "write" | "sync" | "push";

interface FlagSet {
  read?: boolean;
  write?: boolean;
  sync?: boolean;
  push?: boolean;
}

export interface ConnectorInstanceCapabilityFlagsUIProps {
  /** The connector definition's supported flags. */
  supported: FlagSet | null | undefined;
  /** The instance's enabled flags. */
  flags: FlagSet | null | undefined;
  /** The caller has write on the instance; otherwise the flags read as text. */
  canEdit: boolean;
  /** A running job holds the instance: controls disabled with this reason. */
  lockedReason: string | null;
  isPending: boolean;
  onChange: (flag: ConnectorInstanceFlag, checked: boolean) => void;
}

const FLAGS: {
  key: ConnectorInstanceFlag;
  label: string;
  supportedHint: string;
  unsupportedHint: string;
}[] = [
  {
    key: "write",
    label: "Write",
    supportedHint:
      "Allow creating, editing, and deleting entities, records, and field mappings",
    unsupportedHint: "This connector type does not support writes",
  },
  {
    key: "sync",
    label: "Sync",
    supportedHint: "Allow data synchronization with the source",
    unsupportedHint: "This connector type does not support sync",
  },
  {
    key: "push",
    label: "Push",
    supportedHint: "Allow pushing normalized data to external destinations",
    unsupportedHint: "This connector type does not support push",
  },
];

/**
 * The connector instance's Read/Write/Sync/Push flags (#689). Changing them
 * is an instance write the server also refuses while a job holds the
 * instance, so a caller without write sees the enabled flags as chips, and a
 * lock disables the controls with the reason written beneath them.
 */
export const ConnectorInstanceCapabilityFlagsUI = ({
  supported,
  flags,
  canEdit,
  lockedReason,
  isPending,
  onChange,
}: ConnectorInstanceCapabilityFlagsUIProps) => {
  if (!canEdit) {
    const enabled = [
      "Read",
      ...FLAGS.filter((f) => flags?.[f.key]).map((f) => f.label),
    ];
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        {enabled.map((label) => (
          <Chip key={label} label={label} size="small" variant="outlined" />
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Tooltip title="Allow reading data from this connector" describeChild>
          <FormControlLabel
            control={<Checkbox checked disabled size="small" />}
            label="Read"
          />
        </Tooltip>
        {FLAGS.map((f) => {
          const isSupported = !!supported?.[f.key];
          return (
            <Tooltip
              key={f.key}
              title={isSupported ? f.supportedHint : f.unsupportedHint}
              describeChild
            >
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!flags?.[f.key]}
                    onChange={(_e, checked) => onChange(f.key, checked)}
                    disabled={!isSupported || isPending || !!lockedReason}
                    size="small"
                  />
                }
                label={f.label}
              />
            </Tooltip>
          );
        })}
      </Stack>
      {lockedReason ? (
        <Typography variant="caption" color="text.secondary">
          {lockedReason}
        </Typography>
      ) : null}
    </Stack>
  );
};
