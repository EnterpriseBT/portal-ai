import React from "react";
import {
  Box,
  Button,
  Icon,
  IconName,
  Typography,
  useTheme,
} from "../../../../packages/core/dist/ui";
import { alpha } from "@mui/material/styles";
import { useRouter } from "@tanstack/react-router";

export interface HttpErrorProps {
  /** HTTP status code */
  statusCode: number;
  /** Short title displayed as the heading */
  title: string;
  /** Longer description below the heading */
  description?: string;
  /** Show a "Go back" button (default: true) */
  showBackButton?: boolean;
  /** Show a "Go home" button (default: true) */
  showHomeButton?: boolean;
}

const STATUS_ICONS: Record<number, IconName> = {
  401: IconName.Lock,
  403: IconName.Block,
  404: IconName.Search,
  500: IconName.Warning,
};

export const HttpError: React.FC<HttpErrorProps> = ({
  statusCode,
  title,
  description,
  showBackButton = true,
  showHomeButton = true,
}) => {
  const { theme } = useTheme();
  const router = useRouter();

  const iconName = STATUS_ICONS[statusCode] ?? IconName.Warning;

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      textAlign="center"
      py={10}
      px={3}
    >
      <Box mb={1} aria-hidden>
        <Icon
          name={iconName}
          sx={{ fontSize: "5rem", color: theme.palette.error.main }}
        />
      </Box>

      <Typography
        variant="h1"
        style={{
          color: theme.palette.error.main,
          marginBottom: theme.spacing(1),
        }}
      >
        {statusCode}
      </Typography>

      <Typography variant="h4" style={{ marginBottom: theme.spacing(2) }}>
        {title}
      </Typography>

      {description && (
        <Typography
          variant="body1"
          style={{
            color: theme.palette.text.secondary,
            maxWidth: 480,
            marginBottom: theme.spacing(4),
          }}
        >
          {description}
        </Typography>
      )}

      <Box display="flex" gap={2}>
        {showBackButton && (
          <Button
            variant="outlined"
            onClick={() => router.history.back()}
            style={{
              borderColor: alpha(theme.palette.primary.main, 0.5),
            }}
          >
            Go Back
          </Button>
        )}
        {showHomeButton && (
          <Button
            variant="contained"
            onClick={() => router.navigate({ to: "/" })}
          >
            Go Home
          </Button>
        )}
      </Box>
    </Box>
  );
};
