import { Box, Typography } from "@portalai/core/ui";

import { ConnectorInstanceDataItem } from "../components/ConnectorInstance.component";
import DataResult from "../components/DataResult.component";

interface ConnectorInstanceViewProps {
  connectorInstanceId: string;
}

export const ConnectorInstanceView = ({
  connectorInstanceId,
}: ConnectorInstanceViewProps) => {
  return (
    <Box>
      <ConnectorInstanceDataItem id={connectorInstanceId}>
        {(response) => (
          <DataResult results={{ connectorInstance: response }}>
            {({ connectorInstance }) => (
              <Box>
                <Typography variant="h1">
                  {connectorInstance.connectorInstance.name}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Status: {connectorInstance.connectorInstance.status}
                </Typography>
              </Box>
            )}
          </DataResult>
        )}
      </ConnectorInstanceDataItem>
    </Box>
  );
};
