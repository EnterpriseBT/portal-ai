import { auth } from "./auth.api";
import { health } from "./health.api";

export { queryKeys } from "./keys";

export const sdk = {
  auth,
  health,
} as const;
