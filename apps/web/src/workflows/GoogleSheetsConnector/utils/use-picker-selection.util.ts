import { useCallback, useState } from "react";

import type { GoogleConnectorConfig } from "@portalai/core/contracts";

import {
  isPickerConfigured,
  openSheetPicker,
  requestBrowserToken,
  type PickedSheet,
} from "./google-picker.util";

export interface PickerSelection {
  /** True while the token popup / Picker script is in flight. */
  pickerLoading: boolean;
  /** The Picker cannot run — missing runtime config, or a script that will not load. */
  pickerUnavailable: boolean;
  /** Set when the authorized Google account is not the connector's. */
  accountMismatch: { expected: string; authorized: string } | null;
  /** Mints a token, checks the account, then opens the Picker. */
  openPicker: () => void;
}

/**
 * Errors that mean "the user changed their mind", not "this is broken".
 * GIS reports both a closed popup and a refused consent this way.
 */
const USER_ABORTED = /popup_closed|access_denied|user_cancel|abort/i;

/**
 * Owns the browser half of picking a spreadsheet (#408): the token popup,
 * the account-match guard, and the Picker itself.
 *
 * It lives in a hook rather than the container because it is wiring with
 * real branching — worth testing directly, and testable here without
 * mounting the whole workflow behind sdk, SSE, router and popup mocks.
 */
export function usePickerSelection(args: {
  /** The Google account this connector is bound to, if known. */
  linkedEmail: string | null;
  onPicked: (sheet: PickedSheet) => void;
  /** Runtime Google client config from `GET /api/connector-config` (#580);
   *  null when the install has no (complete) Google config. */
  googleConfig: GoogleConnectorConfig | null;
}): PickerSelection {
  const { linkedEmail, onPicked, googleConfig } = args;

  const [pickerLoading, setPickerLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [accountMismatch, setAccountMismatch] = useState<{
    expected: string;
    authorized: string;
  } | null>(null);

  const openPicker = useCallback(() => {
    setPickerLoading(true);
    void (async () => {
      try {
        const token = await requestBrowserToken({
          clientId: googleConfig?.clientId ?? "",
          // A nudge toward the right account in the chooser, not a
          // constraint — which is why the address is checked below.
          loginHint: linkedEmail,
        });

        // Fails open when the connector's address is unknown: blocking a
        // working flow to prevent a maybe is the worse trade, and an
        // undetected mismatch degrades to the pre-#408 behavior.
        if (
          linkedEmail &&
          token.email.toLowerCase() !== linkedEmail.toLowerCase()
        ) {
          setAccountMismatch({
            expected: linkedEmail,
            authorized: token.email,
          });
          return;
        }
        setAccountMismatch(null);

        const picked = await openSheetPicker({
          oauthToken: token.accessToken,
          developerKey: googleConfig?.pickerApiKey ?? "",
          appId: googleConfig?.cloudProjectNumber ?? "",
        });
        // `null` is a cancelled Picker — nothing was granted, nothing to do.
        if (picked) onPicked(picked);
      } catch (err) {
        // Fail closed and visibly, except when the user aborted: telling
        // someone the picker is broken because they closed it would be a
        // lie they cannot act on.
        const message = err instanceof Error ? err.message : String(err);
        if (!USER_ABORTED.test(message)) setUnavailable(true);
      } finally {
        setPickerLoading(false);
      }
    })();
  }, [linkedEmail, onPicked, googleConfig]);

  return {
    pickerLoading,
    // Missing runtime config is as unavailable as a blocked script: the
    // install needs three values from /api/connector-config, and an
    // unconfigured (BYO-Google) install legitimately has none.
    pickerUnavailable: unavailable || !isPickerConfigured(googleConfig),
    accountMismatch,
    openPicker,
  };
}
