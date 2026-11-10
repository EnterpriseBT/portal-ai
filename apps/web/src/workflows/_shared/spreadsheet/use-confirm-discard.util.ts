import { useCallback, useState } from "react";

import type { DiscardImportDialogUIProps } from "./DiscardImportDialog.component";

/**
 * A spreadsheet wizard's close, with a confirmation while it holds drawn
 * regions (#795). `requestClose` goes to the wizard's `Modal` (Escape, the
 * close button); it closes at once when there's nothing to lose.
 */
export function useConfirmDiscard(hasWork: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);

  const requestClose = useCallback(() => {
    if (hasWork) setConfirming(true);
    else onClose();
  }, [hasWork, onClose]);

  const discardDialogProps: DiscardImportDialogUIProps = {
    open: confirming,
    onKeepEditing: () => setConfirming(false),
    onDiscard: () => {
      setConfirming(false);
      onClose();
    },
  };

  return { requestClose, discardDialogProps };
}
