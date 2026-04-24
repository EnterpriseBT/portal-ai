import React from "react";
import { Select, Stack, TextInput } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import type { Terminator } from "@portalai/core/contracts";

export interface TerminatorFormUIProps {
  terminator: Terminator;
  onChange: (terminator: Terminator) => void;
  /** Optional idPrefix so co-rendered copies keep stable input `aria-label`s. */
  idPrefix?: string;
}

const KIND_OPTIONS: SelectOption[] = [
  { value: "untilBlank", label: "Stops after N blanks" },
  { value: "matchesPattern", label: "Stops when cell matches regex" },
];

function isValidRegex(pattern: string): boolean {
  if (pattern.length === 0) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export const TerminatorFormUI: React.FC<TerminatorFormUIProps> = ({
  terminator,
  onChange,
  idPrefix = "terminator",
}) => {
  const handleKindChange = (nextKind: Terminator["kind"]) => {
    if (nextKind === terminator.kind) return;
    if (nextKind === "untilBlank") {
      onChange({ kind: "untilBlank", consecutiveBlanks: 2 });
    } else {
      onChange({ kind: "matchesPattern", pattern: "" });
    }
  };

  const patternInvalid =
    terminator.kind === "matchesPattern" && !isValidRegex(terminator.pattern);

  return (
    <Stack spacing={1}>
      <Select
        size="small"
        label="Terminator"
        value={terminator.kind}
        onChange={(e) => handleKindChange(e.target.value as Terminator["kind"])}
        options={KIND_OPTIONS}
        slotProps={{
          htmlInput: { "aria-label": `${idPrefix} kind` },
        }}
      />

      {terminator.kind === "untilBlank" && (
        <TextInput
          size="small"
          type="number"
          label="Consecutive blanks"
          value={String(terminator.consecutiveBlanks)}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isNaN(n) || n < 1) return;
            onChange({ kind: "untilBlank", consecutiveBlanks: n });
          }}
          slotProps={{
            htmlInput: {
              min: 1,
              "aria-label": `${idPrefix} consecutive blanks`,
            },
          }}
        />
      )}

      {terminator.kind === "matchesPattern" && (
        <TextInput
          size="small"
          label="Pattern (regex)"
          value={terminator.pattern}
          onChange={(e) =>
            onChange({ kind: "matchesPattern", pattern: e.target.value })
          }
          placeholder="e.g. ^Total$"
          error={patternInvalid}
          helperText={
            patternInvalid
              ? "Enter a valid regular expression"
              : "Cell value is matched with RegExp.test()"
          }
          slotProps={{
            htmlInput: {
              "aria-label": `${idPrefix} pattern`,
              "aria-invalid": patternInvalid,
            },
          }}
        />
      )}
    </Stack>
  );
};
