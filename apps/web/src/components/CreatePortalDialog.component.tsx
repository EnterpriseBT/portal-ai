import React, { useState } from "react";

import {
  CreatePortalBodySchema,
  type CreatePortalBody,
  type OrganizationGetResponse,
  type StationListResponsePayload,
} from "@portalai/core/contracts";
import { Button, Modal, Stack } from "@portalai/core/ui";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";

import DataResult from "./DataResult.component";
import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import { OrgData } from "./StationList.component";
import { sdk } from "../api/sdk";

// ── Station option type ─────────────────────────────────────────────

interface StationOption {
  value: string;
  label: string;
}

// ── Station picker ──────────────────────────────────────────────────

interface StationPickerProps {
  defaultStationId: string | null;
  selected: string | null;
  onChange: (stationId: string | null) => void;
  error?: string;
}

const StationPicker: React.FC<StationPickerProps> = ({
  defaultStationId,
  selected,
  onChange,
  error,
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
        const payload =
          data.stations as unknown as StationListResponsePayload;
        const options: StationOption[] = payload.stations.map((s) => ({
          value: s.id,
          label: s.name,
        }));

        // Auto-select default station on first render
        const effectiveSelected = selected ?? defaultStationId;
        const selectedOption =
          options.find((o) => o.value === effectiveSelected) ?? null;

        return (
          <Autocomplete
            options={options}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.value === b.value}
            value={selectedOption}
            onChange={(_, newValue) => onChange(newValue?.value ?? null)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Station"
                placeholder="Select a station..."
                required
                autoFocus
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
  const [orgDefaultStationId, setOrgDefaultStationId] = useState<
    string | null
  >(null);

  React.useEffect(() => {
    if (open) {
      setStationId(null);
      setTouched(false);
    }
  }, [open]);

  const effectiveStationId = stationId ?? orgDefaultStationId;
  const error =
    touched && !effectiveStationId ? "Station is required" : undefined;

  const handleSubmit = () => {
    setTouched(true);
    const body = { stationId: effectiveStationId ?? "" };
    const result = CreatePortalBodySchema.safeParse(body);
    if (!result.success) return;
    onSubmit(result.data);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Portal"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            handleSubmit();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button type="button" variant="outlined" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? "Creating..." : "Create"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <OrgData>
          {(orgResult) => (
            <DataResult results={{ org: orgResult }}>
              {(data) => {
                const org = data.org as unknown as OrganizationGetResponse;
                const defaultId = org.organization.defaultStationId;

                // Sync org default into local state for submit logic
                if (defaultId !== orgDefaultStationId) {
                  // Use a timeout to avoid setState during render
                  setTimeout(() => setOrgDefaultStationId(defaultId), 0);
                }

                return (
                  <StationPicker
                    defaultStationId={defaultId}
                    selected={stationId}
                    onChange={(id) => {
                      setStationId(id);
                      setTouched(true);
                    }}
                    error={error}
                  />
                );
              }}
            </DataResult>
          )}
        </OrgData>
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
