import React, { useState } from "react";

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
import { StationPickerUI, type StationOption } from "./StationPicker.component";
import type { ServerError } from "../utils/api.util";

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
  onStart: (start: { prompt: string; stationId: string }) => void;
}

/**
 * The dashboard's start box (#1123): one line to type a question into, with
 * the station chip and Start inside the same field. The prompt and station
 * are this box's own interaction state, so a failed start keeps what was
 * typed. Enter starts and Shift+Enter adds a line. Start says why it can't
 * run: the caller's gate first, then a start in flight, then a missing
 * station or an empty prompt.
 */
export const StartBoxUI: React.FC<StartBoxUIProps> = ({
  stations,
  initialStationId,
  gate,
  pending,
  serverError,
  onStart,
}) => {
  const [prompt, setPrompt] = useState("");
  // The user's pick, if any; until then the preselected station. Either
  // counts only while it's a station the caller can see, so a deleted or
  // unreadable one (or one that hasn't loaded yet) reads as "Pick a
  // station" and is never sent.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const candidate = pickedId ?? initialStationId;
  const stationId = stations.some((s) => s.id === candidate) ? candidate : null;

  const startGate: ActionGate =
    gate && gate.kind !== "allow"
      ? gate
      : pending
        ? pendingGate(true, "Starting…")
        : !stationId
          ? { kind: "disable", reason: "Pick a station to start" }
          : !prompt.trim()
            ? { kind: "disable", reason: "Type a question to start" }
            : ALLOW;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (startGate.kind !== "allow" || !stationId) return;
    onStart({ prompt: prompt.trim(), stationId });
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
          actions={
            <>
              <StationPickerUI
                stations={stations}
                selectedId={stationId}
                onSelect={setPickedId}
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
