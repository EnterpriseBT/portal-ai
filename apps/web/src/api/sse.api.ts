import { useAuth0 } from "@auth0/auth0-react";
import { useCallback } from "react";

import { resolveApiUrl } from "../utils/api.util";

/**
 * Hook that returns an authenticated SSE connection factory.
 *
 * The token is passed as a query parameter because the EventSource API
 * does not support custom headers (no Authorization header possible).
 */
function useCreate() {
  const { getAccessTokenSilently } = useAuth0();

  const connect = useCallback(
    async (path: string): Promise<EventSource> => {
      const token = await getAccessTokenSilently({
        authorizationParams: {
          audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        },
      });
      const url = resolveApiUrl(
        `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      );
      return new EventSource(url);
    },
    [getAccessTokenSilently]
  );

  return connect;
}

export const sse = {
  create: useCreate,
};
