import { useCallback } from "react";

import { useAuth } from "../providers/Auth.provider";
import { resolveApiUrl } from "../utils/api.util";

/**
 * Hook that returns an authenticated SSE connection factory.
 *
 * The token is passed as a query parameter because the EventSource API
 * does not support custom headers (no Authorization header possible).
 * The token comes from the auth seam (#607), not a vendor SDK directly.
 */
function useCreate() {
  const { getToken } = useAuth();

  const connect = useCallback(
    async (path: string): Promise<EventSource> => {
      const token = await getToken();
      const url = resolveApiUrl(
        `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      );
      return new EventSource(url);
    },
    [getToken]
  );

  return connect;
}

export const sse = {
  create: useCreate,
};
