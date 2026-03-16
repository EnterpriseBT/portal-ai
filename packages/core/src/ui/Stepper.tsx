import React from "react";
import MuiStepper from "@mui/material/Stepper";
import MuiStep from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export type StepValidateResult = boolean | string;

export interface StepConfig {
  label: string;
  description?: string;
  optional?: boolean;
  validate?: () => StepValidateResult | Promise<StepValidateResult>;
}

export interface StepValidationError {
  step: StepConfig;
  message: string;
}

export interface StepPanelProps {
  children?: React.ReactNode;
  index: number;
  activeStep: number;
  className?: string;
  [key: `data-${string}`]: string;
}

export interface StepperProps {
  steps: StepConfig[];
  activeStep: number;
  orientation?: "horizontal" | "vertical";
  alternativeLabel?: boolean;
  className?: string;
  children?: React.ReactNode;
  [key: `data-${string}`]: string;
}

export interface StepperNavigationProps {
  onBack: () => void;
  onNext: () => void | Promise<void>;
  onReset?: () => void;
  isFirstStep: boolean;
  isLastStep: boolean;
  isComplete: boolean;
  backLabel?: string;
  nextLabel?: string;
  completeLabel?: string;
  resetLabel?: string;
  disabled?: boolean;
  className?: string;
  [key: `data-${string}`]: string;
}

export interface UseStepperOptions {
  steps: StepConfig[];
  initialStep?: number;
  onComplete?: () => void;
  onStepChange?: (step: number) => void;
}

export interface UseStepperReturn {
  activeStep: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  isComplete: boolean;
  validationError: StepValidationError | null;
  goToNext: () => Promise<void>;
  goBack: () => void;
  reset: () => void;
  stepperProps: {
    steps: StepConfig[];
    activeStep: number;
  };
  getStepPanelProps: (index: number) => {
    index: number;
    activeStep: number;
  };
  navigationProps: {
    onBack: () => void;
    onNext: () => Promise<void>;
    onReset: () => void;
    isFirstStep: boolean;
    isLastStep: boolean;
    isComplete: boolean;
  };
}

export function useStepper({
  steps,
  initialStep = 0,
  onComplete,
  onStepChange,
}: UseStepperOptions): UseStepperReturn {
  const [activeStep, setActiveStep] = React.useState(initialStep);
  const [isComplete, setIsComplete] = React.useState(false);
  const [validationError, setValidationError] =
    React.useState<StepValidationError | null>(null);

  const isFirstStep = activeStep === 0;
  const isLastStep = activeStep === steps.length - 1;

  const goToNext = React.useCallback(async () => {
    const currentStep = steps[activeStep];
    if (currentStep?.validate) {
      try {
        const result = await currentStep.validate();
        if (result !== true) {
          const message =
            typeof result === "string"
              ? result
              : `Please complete "${currentStep.label}" before continuing`;
          setValidationError({ step: currentStep, message });
          return;
        }
      } catch {
        setValidationError({
          step: currentStep,
          message: `Validation failed for "${currentStep.label}"`,
        });
        return;
      }
    }

    setValidationError(null);

    if (isLastStep) {
      setIsComplete(true);
      onComplete?.();
    } else {
      const next = activeStep + 1;
      setActiveStep(next);
      onStepChange?.(next);
    }
  }, [activeStep, steps, isLastStep, onComplete, onStepChange]);

  const goBack = React.useCallback(() => {
    if (!isFirstStep) {
      setValidationError(null);
      const prev = activeStep - 1;
      setActiveStep(prev);
      onStepChange?.(prev);
    }
  }, [activeStep, isFirstStep, onStepChange]);

  const reset = React.useCallback(() => {
    setActiveStep(0);
    setIsComplete(false);
    setValidationError(null);
    onStepChange?.(0);
  }, [onStepChange]);

  return {
    activeStep,
    isFirstStep,
    isLastStep,
    isComplete,
    validationError,
    goToNext,
    goBack,
    reset,
    stepperProps: { steps, activeStep },
    getStepPanelProps: (index: number) => ({ index, activeStep }),
    navigationProps: {
      onBack: goBack,
      onNext: goToNext,
      onReset: reset,
      isFirstStep,
      isLastStep,
      isComplete,
    },
  };
}

export const Stepper = React.forwardRef<HTMLDivElement, StepperProps>(
  (
    { steps, activeStep, orientation = "horizontal", alternativeLabel, children, className, ...rest },
    ref
  ) => {
    return (
      <Box ref={ref} className={className} {...rest}>
        <MuiStepper
          activeStep={activeStep}
          orientation={orientation}
          alternativeLabel={alternativeLabel}
        >
          {steps.map((step) => (
            <MuiStep key={step.label}>
              <StepLabel
                optional={
                  step.optional ? (
                    <Typography variant="caption">Optional</Typography>
                  ) : undefined
                }
              >
                {step.label}
              </StepLabel>
            </MuiStep>
          ))}
        </MuiStepper>
        {children}
      </Box>
    );
  }
);

export const StepPanel = React.forwardRef<HTMLDivElement, StepPanelProps>(
  ({ children, index, activeStep, ...props }, ref) => {
    return (
      <Box
        ref={ref}
        role="tabpanel"
        hidden={activeStep !== index}
        id={`step-panel-${index}`}
        aria-labelledby={`step-${index}`}
        {...props}
      >
        {activeStep === index && <Box padding={2}>{children}</Box>}
      </Box>
    );
  }
);

export const StepperNavigation = React.forwardRef<
  HTMLDivElement,
  StepperNavigationProps
>(
  (
    {
      onBack,
      onNext,
      onReset,
      isFirstStep,
      isLastStep,
      isComplete,
      backLabel = "Back",
      nextLabel = "Next",
      completeLabel = "Finish",
      resetLabel = "Reset",
      disabled = false,
      className,
      ...rest
    },
    ref
  ) => {
    if (isComplete) {
      return onReset ? (
        <Stack
          ref={ref}
          direction="row"
          justifyContent="flex-end"
          sx={{ pt: 2 }}
          className={className}
          {...rest}
        >
          <Button onClick={onReset} variant="outlined">
            {resetLabel}
          </Button>
        </Stack>
      ) : null;
    }

    return (
      <Stack
        ref={ref}
        direction="row"
        justifyContent="space-between"
        sx={{ pt: 2 }}
        className={className}
        {...rest}
      >
        <Button onClick={onBack} disabled={isFirstStep || disabled} variant="text">
          {backLabel}
        </Button>
        <Button onClick={onNext} disabled={disabled} variant="contained">
          {isLastStep ? completeLabel : nextLabel}
        </Button>
      </Stack>
    );
  }
);

export default Stepper;
