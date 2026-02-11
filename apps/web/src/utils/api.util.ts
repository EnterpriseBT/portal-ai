import { useAuth0 } from "@auth0/auth0-react";
import { useCallback } from "react";

/**
 * Hook that returns an authenticated fetch function.
 * Retrieves the access token from Auth0 and attaches it as a Bearer token.
 *
 * Usage:
 *   const { fetchWithAuth } = useAuthFetch();
 *   const data = await fetchWithAuth("/api/me");
 */
export const useAuthFetch = () => {
  const { getAccessTokenSilently } = useAuth0();

  const fetchWithAuth = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const token = await getAccessTokenSilently();

      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      return response;
    },
    [getAccessTokenSilently],
  );

  return { fetchWithAuth };
};
