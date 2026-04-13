import React from "react";

import { Box, Button, Stack, Typography } from "@portalai/core/ui";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";

import type { GettingStartedStep } from "../utils/getting-started.util";

export interface GettingStartedProps {
  steps: GettingStartedStep[];
  onNavigate: (route: string) => void;
}

export const GettingStarted: React.FC<GettingStartedProps> = ({
  steps,
  onNavigate,
}) => {
  return (
    <Stack spacing={2}>
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        return (
          <Card
            key={step.title}
            data-testid={`getting-started-step-${stepNumber}`}
            variant="outlined"
          >
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="flex-start">
                <Box
                  data-testid={`getting-started-step-number-${stepNumber}`}
                  sx={(theme) => ({
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    backgroundColor: theme.palette.primary.main,
                    color: theme.palette.primary.contrastText,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 600,
                    flexShrink: 0,
                  })}
                >
                  {stepNumber}
                </Box>
                <Stack spacing={1} sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {step.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {step.description}
                  </Typography>
                  <Box>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => onNavigate(step.ctaRoute)}
                    >
                      {step.ctaLabel}
                    </Button>
                  </Box>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
};
