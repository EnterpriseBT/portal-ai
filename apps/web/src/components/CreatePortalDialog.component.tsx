import React, { useState } from "react";

import {
  CreatePortalBodySchema,
  type CreatePortalBody,
  type StationListResponsePayload,
} from "@portalai/core/contracts";
import { GatedButton, Modal, pendingGate, Stack } from "@portalai/core/ui";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";

import DataResult from "./DataResult.component";
import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import { focusFirstInvalidField } from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { sdk } from "../api/sdk";

// ── Station option type ─────────────────────────────────────────────

interface StationOption {
  value: string;
  label: string;
}

// ── Station picker ──────────────────────────────────────────────────

interface StationPickerProps {
  selected: string | null;
  onChange: (stationId: string | null) => void;
  error?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

const StationPicker: React.FC<StationPickerProps> = ({
  selected,
  onChange,
  error,
  inputRef,
}) => {
  const result = sdk.stations.list({
    limit: 100,
    offset: 0,
    sortBy: "name",
    sortOrder: "asc",
  });

  return (
    <DataResult results={{ stations: result }}>
      {(data) => {
        const payload = data.stations as unknown as StationListResponsePayload;
        const options: StationOption[] = payload.stations.map((s) => ({
          value: s.id,
          label: s.name,
        }));

        // #1114: nothing is preselected; the caller picks a station.
        const selectedOption =
          options.find((o) => o.value === selected) ?? null;

        return (
          <Autocomplete
            options={options}
            getOptionLabel={(o) => o.label}
            // By id: two stations can share a name (#986).
            getOptionKey={(o) => o.value}
            isOptionEqualToValue={(a, b) => a.value === b.value}
            value={selectedOption}
            onChange={(_, newValue) => onChange(newValue?.value ?? null)}
            renderInput={(params) => (
              <TextField
                {...params}
                inputRef={inputRef}
                label="Station"
                placeholder="Select a station..."
                required
                error={!!error}
                helperText={error}
              />
            )}
          />
        );
      }}
    </DataResult>
  );
};

// ── Component ───────────────────────────────────────────────────────

export interface CreatePortalDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: CreatePortalBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

export const CreatePortalDialog: React.FC<CreatePortalDialogProps> = ({
  open,
  onClose,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [stationId, setStationId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const stationRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      setStationId(null);
      setTouched(false);
    }
  }, [open]);

  const error = touched && !stationId ? "Station is required" : undefined;

  const handleSubmit = () => {
    setTouched(true);
    const body = { stationId: stationId ?? "" };
    const result = CreatePortalBodySchema.safeParse(body);
    if (!result.success) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    onSubmit(result.data);
  };

  return (
    <Modal
      pending={isPending}
      submitDisabled={isPending}
      open={open}
      onClose={onClose}
      title="New Portal"
      maxWidth="sm"
      fullWidth
      onSubmit={handleSubmit}
      actions={
        <Stack direction="row" spacing={1}>
          <GatedButton
            type="button"
            variant="outlined"
            onClick={onClose}
            gate={pendingGate(isPending, "Wait for this to finish")}
          >
            Cancel
          </GatedButton>
          <GatedButton
            type="button"
            variant="contained"
            onClick={handleSubmit}
            gate={pendingGate(isPending)}
          >
            {isPending ? "Creating..." : "Create"}
          </GatedButton>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <StationPicker
          selected={stationId}
          inputRef={stationRef}
          onChange={(id) => {
            setStationId(id);
            setTouched(true);
          }}
          error={error}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
