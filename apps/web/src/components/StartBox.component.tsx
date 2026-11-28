import React, { useState } from "react";

import {
  StartPortalBodySchema,
  type StartPortalBody,
} from "@portalai/core/contracts";

import {
  ALLOW,
  Box,
  Composer,
  GatedButton,
  Icon,
  IconName,
  Stack,
  pendingGate,
  type ActionGate,
} from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import {
  StationPickerUI,
  type StationOption,
  type StationSearch,
} from "./StationPicker.component";
import type { ServerError } from "../utils/api.util";
import {
  focusFirstInvalidField,
  validateWithSchema,
  type FormErrors,
} from "../utils/form-validation.util";
import { PICKED_STATION_GROUP } from "../utils/start-box-stations.util";

export interface StartBoxUIProps {
  stations: StationOption[];
  /** A station to preselect, if the caller has one (there's no org default
   *  station). Used until the user picks one, and only while it's among
   *  `stations`. */
  initialStationId: string | null;
  /** Whether the caller may start a portal (permission, then plan). */
  gate?: ActionGate;
  /** A start is in flight. */
  pending: boolean;
  serverError: ServerError | null;
  /** #1079: a portal with its first question, already validated. */
  onStart: (body: StartPortalBody) => void;
  /** #1079: search every station the caller can see, not only `stations`. */
  stationSearch?: StationSearch;
}

/**
 * The dashboard's start box (#1123): one line to type a question into, with
 * the station chip and Start inside the same field. The prompt and station
 * are this box's own interaction state, so a failed start keeps what was
 * typed. Enter starts and Shift+Enter adds a line. Start says why it can't
 * run: the caller's gate first, then a start in flight, then a missing
 * station or an empty prompt. A question over the message limit is caught
 * on submit (#1079), shown under the field, and kept: never cut.
 */
export const StartBoxUI: React.FC<StartBoxUIProps> = ({
  stations,
  initialStationId,
  gate,
  pending,
  serverError,
  onStart,
  stationSearch,
}) => {
  const [prompt, setPrompt] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // The user's pick, if any; until then the preselected station. A
  // preselection counts only while it's among `stations`, so a deleted or
  // unreadable one (or one that hasn't loaded yet) reads as "Pick a
  // station" and is never sent. A pick is kept with its option (#1079): one
  // found by search stays named after the query moves on.
  const [picked, setPicked] = useState<StationOption | null>(null);
  // #1137 adversarial walk: after the create answers, the dashboard stays on
  // screen until the new portal's page loads, and dedupe only covers a
  // request still in flight. So a start holds Start until the box goes or
  // the start fails; otherwise a late click makes a second portal.
  const [launched, setLaunched] = useState(false);
  const holding = pending || (launched && !serverError);
  const known = picked
    ? stations.some((s) => s.id === picked.id)
      ? stations
      : [...stations, { ...picked, group: PICKED_STATION_GROUP }]
    : stations;
  const candidate = picked?.id ?? initialStationId;
  const stationId = known.some((s) => s.id === candidate) ? candidate : null;

  // Re-validated as the prompt changes, so an error clears once it fits.
  // Shown only after the field is left or the form submitted.
  const validation = validateWithSchema(StartPortalBodySchema, {
    stationId: stationId ?? "",
    initialMessage: prompt,
  });
  const errors: FormErrors = validation.success ? {} : validation.errors;
  const promptError =
    (touched || submitted) && prompt.trim() !== ""
      ? (errors.initialMessage ?? null)
      : null;

  const handlePick = (id: string) => {
    const option =
      known.find((s) => s.id === id) ??
      stationSearch?.results.find((s) => s.id === id) ??
      null;
    if (option) setPicked(option);
  };

  const startGate: ActionGate =
    gate && gate.kind !== "allow"
      ? gate
      : holding
        ? pendingGate(true, "Starting…")
        : !stationId
          ? { kind: "disable", reason: "Pick a station to start" }
          : !prompt.trim()
            ? { kind: "disable", reason: "Type a question to start" }
            : ALLOW;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (startGate.kind !== "allow" || !stationId) return;
    setSubmitted(true);
    if (!validation.success) {
      // After the error renders, so its aria-invalid is there to find. The
      // form is read now: React clears currentTarget once this returns.
      const form = event.currentTarget;
      requestAnimationFrame(() => focusFirstInvalidField(form));
      return;
    }
    setLaunched(true);
    onStart(validation.data);
  };

  // A multiline field never submits on Enter by itself, so Enter asks the
  // form to, through the same submit path (and gate) as the Start button.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <Box component="form" onSubmit={handleSubmit} aria-label="Start a portal">
      <Stack spacing={1}>
        <Composer
          aria-label="Ask a question"
          placeholder="Ask anything about your data…"
          description="Enter to start, Shift+Enter for a new line"
          value={prompt}
          onChange={setPrompt}
          onKeyDown={handleKeyDown}
          onBlur={() => setTouched(true)}
          error={promptError}
          actions={
            <>
              <StationPickerUI
                stations={known}
                selectedId={stationId}
                onSelect={handlePick}
                search={stationSearch}
              />
              <GatedButton
                type="submit"
                size="small"
                gate={startGate}
                startIcon={<Icon name={IconName.Send} />}
              >
                Start
              </GatedButton>
            </>
          }
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Box>
  );
};
