import React, { useMemo, useState } from "react";

import TextField from "@mui/material/TextField";
import { z, type ZodType } from "zod";

import { blurUnlessDialogControl } from "../../utils/dialog-blur.util";
import { validateWithSchema } from "../../utils/form-validation.util";
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";

export interface NameFieldProps {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  /** The contract's `name` rule (e.g. `PolicyUpsertRequestSchema.shape.name`). */
  rule: ZodType<string>;
  label?: string;
}

/**
 * The required name field of an access-authoring editor (#789). Validates the
 * trimmed value against the contract's rule and shows the error once the
 * field is touched (a blur, but not a blur toward Cancel). The editor's Save
 * stays disabled while the name is empty, so this is the reason, not the gate.
 */
export const NameField: React.FC<NameFieldProps> = ({
  open,
  value,
  onChange,
  rule,
  label = "Name",
}) => {
  const [touched, setTouched] = useState(false);
  const inputRef = useDialogAutoFocus(open);
  const schema = useMemo(() => z.object({ name: rule }), [rule]);
  const result = validateWithSchema(schema, { name: value.trim() });
  const error = touched && !result.success ? result.errors.name : undefined;
  return (
    <TextField
      inputRef={inputRef}
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={blurUnlessDialogControl(() => setTouched(true))}
      error={!!error}
      helperText={error}
      slotProps={{ htmlInput: { "aria-invalid": !!error } }}
      required
      fullWidth
    />
  );
};
