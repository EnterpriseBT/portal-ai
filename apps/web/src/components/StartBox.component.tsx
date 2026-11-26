import React, { useRef, useState } from "react";

import {
  ALLOW,
  Box,
  GatedButton,
  Icon,
  IconName,
  Stack,
  TextInput,
  Typography,
  pendingGate,
  type ActionGate,
} from "@portalai/core/ui";
import Chip from "@mui/material/Chip";

import { FormAlert } from "./FormAlert.component";
import { StationPickerUI, type StationOption } from "./StationPicker.component";
import type { ServerError } from "../utils/api.util";

export interface StartBoxUIProps {
  stations: StationOption[];
  /** The station chosen when the box mounts: the caller's default, if any. */
  initialStationId: string | null;
  /** Prompts offered while the box is empty. Choosing one fills it in. */
  examples: string[];
  /** Whether the caller may start a portal (permission, then plan). */
  gate?: ActionGate;
  /** A start is in flight. */
  pending: boolean;
  serverError: ServerError | null;
  onStart: (start: { prompt: string; stationId: string }) => void;
}

/**
 * The dashboard's start box (#1123): type a question, pick a station, start
 * a portal. The prompt and station are this box's own interaction state, so
 * a failed start keeps what was typed. Enter starts and Shift+Enter adds a
 * line. Start says why it can't run: the caller's gate first, then a start
 * in flight, then a missing station or an empty prompt.
 */
export const StartBoxUI: React.FC<StartBoxUIProps> = ({
  stations,
  initialStationId,
  examples,
  gate,
  pending,
  serverError,
  onStart,
}) => {
  const [prompt, setPrompt] = useState("");
  const [stationId, setStationId] = useState<string | null>(initialStationId);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    (event.target as HTMLTextAreaElement).form?.requestSubmit();
  };

  const handleExample = (example: string) => {
    setPrompt(example);
    inputRef.current?.focus();
  };

  return (
    <Box component="form" onSubmit={handleSubmit} aria-label="Start a portal">
      <Stack spacing={1.5}>
        <TextInput
          label="Ask a question"
          multiline
          minRows={2}
          maxRows={8}
          fullWidth
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          helperText="Enter to start, Shift+Enter for a new line"
        />
        <FormAlert serverError={serverError} />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
        >
          <StationPickerUI
            stations={stations}
            selectedId={stationId}
            onSelect={setStationId}
          />
          <GatedButton
            type="submit"
            gate={startGate}
            startIcon={<Icon name={IconName.Send} />}
          >
            Start
          </GatedButton>
        </Stack>
        {!prompt && examples.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="body2" color="text.secondary">
              Try:
            </Typography>
            {examples.map((example) => (
              <Chip
                key={example}
                label={example}
                variant="outlined"
                size="small"
                onClick={() => handleExample(example)}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};
