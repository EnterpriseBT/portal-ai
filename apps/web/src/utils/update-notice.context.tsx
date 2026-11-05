import React, { createContext, useContext } from "react";

import { useAppVersion } from "./app-version.util";

export interface UpdateNotice {
  /** A new version is available and the user hasn't dismissed the notice. */
  open: boolean;
  dismiss: () => void;
}

const CLOSED: UpdateNotice = { open: false, dismiss: () => {} };

export const UpdateNoticeContext = createContext<UpdateNotice>(CLOSED);

/**
 * Owns the app-version poll once (#797), so the update banner and the skip
 * links ("Skip to notifications" while the notice is up) read one state.
 */
export const UpdateNoticeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { updateAvailable, dismiss } = useAppVersion();
  return (
    <UpdateNoticeContext.Provider value={{ open: updateAvailable, dismiss }}>
      {children}
    </UpdateNoticeContext.Provider>
  );
};

/** The update notice's state; closed when no provider is mounted. */
export function useUpdateNotice(): UpdateNotice {
  return useContext(UpdateNoticeContext);
}
