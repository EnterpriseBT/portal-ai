import React, { useState } from "react";

import { Button, Modal, Stack } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";

/**
 * One-time reveal of a per-toolpack HMAC signing secret.
 *
 * Phase 6: the API surfaces the plaintext signing secret exactly
 * once — on the registration response and on rotation. This dialog
 * is the canonical UI for that reveal: a read-only `whsec_*` value
 * with a copy-to-clipboard affordance and a warning that the value
 * cannot be shown again.
 *
 * The dialog is shared by the register flow (after successful
 * registration) and the edit flow (after the rotate button fires).
 */
export interface SigningSecretRevealDialogUIProps {
  open: boolean;
  /** Plaintext `whsec_*` value to display. `null` hides the dialog. */
  signingSecret: string | null;
  onClose: () => void;
}

export const SigningSecretRevealDialogUI: React.FC<
  SigningSecretRevealDialogUIProps
> = ({ open, signingSecret, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!signingSecret) return;
    try {
      await navigator.clipboard.writeText(signingSecret);
      setCopied(true);
      // Auto-revert the checkmark after a short delay so the icon
      // is back to "copy" by the time the dialog reopens.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context, permissions). The
      // user can still select-and-copy the input manually.
    }
  };

  return (
    <Modal
      open={open && signingSecret !== null}
      onClose={onClose}
      title="Your toolpack signing secret"
      maxWidth="sm"
      fullWidth
      actions={
        <Stack direction="row" spacing={1}>
          <Button type="button" variant="contained" onClick={onClose}>
            Done
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Alert severity="warning" data-testid="signing-secret-warning">
          <AlertTitle>Copy this now — it will not be shown again</AlertTitle>
          <Typography variant="body2">
            Configure your toolpack server to verify the{" "}
            <code>X-Portalai-Signature</code> header using this secret. To see
            it again, rotate the secret from the edit dialog.
          </Typography>
        </Alert>
        <TextField
          label="Signing secret"
          value={signingSecret ?? ""}
          fullWidth
          slotProps={{
            input: {
              readOnly: true,
              sx: { fontFamily: "monospace" },
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={copied ? "Copied" : "Copy signing secret"}
                    onClick={handleCopy}
                    edge="end"
                    data-testid="signing-secret-copy"
                  >
                    {copied ? (
                      <CheckIcon fontSize="small" />
                    ) : (
                      <ContentCopyIcon fontSize="small" />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            },
            htmlInput: {
              "data-testid": "signing-secret-input",
              spellCheck: false,
            } as object,
          }}
        />
      </Stack>
    </Modal>
  );
};
