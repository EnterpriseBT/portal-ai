import React from "react";
import { Box, Tooltip } from "@mcp-ui/core/ui";
import { keyframes } from "@mui/material/styles";
import type { HealthGetResponse } from "@mcp-ui/core/contracts";
import { DataResult } from "./DataResult.component";
import { sdk } from "../api/sdk";

const glow = (color: string) =>
  keyframes`
    0%, 100% { box-shadow: 0 0 4px 1px ${color}; }
    50% { box-shadow: 0 0 10px 4px ${color}; }
  `;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const indicatorStyles = {
  width: 12,
  height: 12,
  borderRadius: "50%",
  display: "inline-block",
  flexShrink: 0,
} as const;

export interface HealthCheckUIProps {
  data: HealthGetResponse;
  className?: string;
  [key: `data-${string}`]: string;
}

export const HealthCheckUI: React.FC<HealthCheckUIProps> = ({
  data,
  className,
  ...rest
}) => {
  const timestamp = data.timestamp
    ? new Date(data.timestamp).toLocaleString()
    : "unknown";

  return (
    <Tooltip title={`Healthy — last checked: ${timestamp}`}>
      <Box
        className={className}
        {...rest}
        sx={{
          ...indicatorStyles,
          bgcolor: "success.main",
          animation: `${glow("#36B37E")} 2s ease-in-out infinite`,
        }}
      />
    </Tooltip>
  );
};

export interface HealthCheckProps {
  className?: string;
  [key: `data-${string}`]: string;
}

export const HealthCheck: React.FC<HealthCheckProps> = ({
  className,
  ...rest
}) => {
  const query = sdk.health.check();

  return (
    <DataResult
      results={{ health: query }}
      options={{
        health: {
          renderError: (error) => (
            <Tooltip title={error.message ?? "Health check failed"}>
              <Box
                className={className}
                {...rest}
                sx={{
                  ...indicatorStyles,
                  bgcolor: "error.main",
                  animation: `${glow("#FF5630")} 2s ease-in-out infinite`,
                }}
              />
            </Tooltip>
          ),
          renderLoading: () => (
            <Tooltip title="Checking health...">
              <Box
                className={className}
                {...rest}
                sx={{
                  ...indicatorStyles,
                  bgcolor: "grey.500",
                  animation: `${pulse} 1.5s ease-in-out infinite`,
                }}
              />
            </Tooltip>
          ),
        },
      }}
    >
      {({ health }) => (
        <HealthCheckUI data={health} className={className} {...rest} />
      )}
    </DataResult>
  );
};

export default HealthCheck;
