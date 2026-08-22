import React from "react";

/**
 * Syncs the response's `nextCursor` into pagination state via an effect
 * (#433), so `Next` has a position to seek to.
 *
 * Mirrors `SyncTotal` — the response carries a value the pagination hook
 * needs, and the hook cannot reach into the query result itself.
 */
export const SyncNextCursor = ({
  nextCursor,
  setNextCursor,
  children,
}: {
  nextCursor: string | null | undefined;
  setNextCursor: (cursor: string | null) => void;
  children: React.ReactNode;
}) => {
  React.useEffect(() => {
    setNextCursor(nextCursor ?? null);
  }, [nextCursor, setNextCursor]);
  return <>{children}</>;
};
