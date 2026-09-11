import type { ConnectorConfigResponse } from "@portalai/core/contracts";

import { useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const connectorConfig = {
  /**
   * The app's public connector client config, served at runtime (#580) so a
   * prebuilt image can carry a self-hosted install's own values. Authenticated
   * — non-secret browser identifiers only. `google` is null when unconfigured.
   */
  get: (options?: QueryOptions<ConnectorConfigResponse>) =>
    useAuthQuery<ConnectorConfigResponse>(
      queryKeys.connectorConfig.get(),
      "/api/connector-config",
      undefined,
      options
    ),
};
