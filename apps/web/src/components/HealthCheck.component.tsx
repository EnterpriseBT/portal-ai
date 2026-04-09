import React from "react";
import { Box, Stack, Tooltip, Typography } from "@portalai/core/ui";
import { keyframes } from "@mui/material/styles";
import type { HealthGetResponse } from "@portalai/core/contracts";
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
  /** When true, renders a text caption next to the indicator dot. */
  showLabel?: boolean;
  className?: string;
  [key: `data-${string}`]: string;
}

export const HealthCheck: React.FC<HealthCheckProps> = ({
  showLabel,
  className,
  ...rest
}) => {
  const query = sdk.health.check();

  const withLabel = (indicator: React.ReactNode, label: string) =>
    showLabel ? (
      <Stack direction="row" alignItems="center" spacing={1}>
        {indicator}
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </Stack>
    ) : (
      indicator
    );

  return (
    <DataResult
      results={{ health: query }}
      options={{
        health: {
          renderError: (error) =>
            withLabel(
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
              </Tooltip>,
              "API unreachable"
            ),
          renderLoading: () =>
            withLabel(
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
              </Tooltip>,
              "Checking API…"
            ),
        },
      }}
    >
      {({ health }) =>
        withLabel(
          <HealthCheckUI data={health} className={className} {...rest} />,
          `API connected — ${health.version} (${health.sha})`
        )
      }
    </DataResult>
  );
};

export default HealthCheck;
