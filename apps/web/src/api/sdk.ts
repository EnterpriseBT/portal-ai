import { auth } from "./auth.api";
import { health } from "./health.api";
import { organizations } from "./organizations.api";

export { queryKeys } from "./keys";

export const sdk = {
  auth,
  health,
  organizations,
} as const;
