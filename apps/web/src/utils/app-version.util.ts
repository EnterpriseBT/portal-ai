import { useState, useEffect, useCallback } from "react";

const POLL_INTERVAL_MS = 60_000;

interface AppVersionState {
  updateAvailable: boolean;
  dismiss: () => void;
}

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/version.json", { cache: "no-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.version ?? null;
  } catch {
    return null;
  }
}

export function useAppVersion(pollInterval = POLL_INTERVAL_MS): AppVersionState {
  const [initialVersion, setInitialVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Capture the version at mount time
  useEffect(() => {
    fetchVersion().then((v) => {
      if (v) setInitialVersion(v);
    });
  }, []);

  // Poll for changes once we have the initial version
  useEffect(() => {
    if (!initialVersion) return;

    const id = setInterval(async () => {
      const latest = await fetchVersion();
      if (latest && latest !== initialVersion) {
        setUpdateAvailable(true);
      }
    }, pollInterval);

    return () => clearInterval(id);
  }, [initialVersion, pollInterval]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return {
    updateAvailable: updateAvailable && !dismissed,
    dismiss,
  };
}
