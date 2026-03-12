import React from "react";

/** Syncs the response total into pagination state via an effect. */
export const SyncTotal = ({
  total,
  setTotal,
  children,
}: {
  total: number | undefined;
  setTotal: (t: number) => void;
  children: React.ReactNode;
}) => {
  React.useEffect(() => {
    if (total !== undefined) {
      setTotal(total);
    }
  }, [total, setTotal]);
  return <>{children}</>;
};
