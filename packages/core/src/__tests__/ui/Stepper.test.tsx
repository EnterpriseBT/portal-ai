import React, { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import {
  Stepper,
  StepPanel,
  StepperNavigation,
  useStepper,
  type StepConfig,
  type StepValidationError,
} from "../../ui/Stepper";

const basicSteps: StepConfig[] = [
  { label: "Step One" },
  { label: "Step Two" },
  { label: "Step Three" },
];

let lastValidationError: StepValidationError | null = null;

const UseStepperExample = ({
  steps = basicSteps,
  onComplete,
  onStepChange,
}: {
  steps?: StepConfig[];
  onComplete?: () => void;
  onStepChange?: (step: number) => void;
}) => {
  const { stepperProps, getStepPanelProps, navigationProps, validationError } =
    useStepper({ steps, onComplete, onStepChange });

  useEffect(() => {
    lastValidationError = validationError;
  });

  return (
    <>
      <Stepper {...stepperProps}>
        <StepPanel {...getStepPanelProps(0)}>Step One Content</StepPanel>
        <StepPanel {...getStepPanelProps(1)}>Step Two Content</StepPanel>
        <StepPanel {...getStepPanelProps(2)}>Step Three Content</StepPanel>
      </Stepper>
      {validationError && (
        <div data-testid="validation-error">{validationError.message}</div>
      )}
      <StepperNavigation {...navigationProps} />
    </>
  );
};

describe("Stepper Components", () => {
  beforeEach(() => {
    lastValidationError = null;
  });

  describe("Stepper", () => {
    it("should render all step labels", () => {
      render(
        <Stepper steps={basicSteps} activeStep={0}>
          <div>Content</div>
        </Stepper>
      );
      expect(screen.getByText("Step One")).toBeInTheDocument();
      expect(screen.getByText("Step Two")).toBeInTheDocument();
      expect(screen.getByText("Step Three")).toBeInTheDocument();
    });

    it("should render children", () => {
      render(
        <Stepper steps={basicSteps} activeStep={0}>
          <div>Step Content</div>
        </Stepper>
      );
      expect(screen.getByText("Step Content")).toBeInTheDocument();
    });

    it("should render optional label for optional steps", () => {
      const steps: StepConfig[] = [
        { label: "Required" },
        { label: "Skippable", optional: true },
      ];
      render(<Stepper steps={steps} activeStep={0} />);
      expect(screen.getByText("Optional")).toBeInTheDocument();
    });

    it("should accept custom className", () => {
      const { container } = render(
        <Stepper steps={basicSteps} activeStep={0} className="custom" />
      );
      expect(container.firstChild).toHaveClass("custom");
    });

    it("should accept custom data attributes", () => {
      render(
        <Stepper steps={basicSteps} activeStep={0} data-testid="my-stepper" />
      );
      expect(screen.getByTestId("my-stepper")).toBeInTheDocument();
    });
  });

  describe("StepPanel", () => {
    it("should show content for the active step", () => {
      render(
        <>
          <StepPanel index={0} activeStep={0}>
            First
          </StepPanel>
          <StepPanel index={1} activeStep={0}>
            Second
          </StepPanel>
        </>
      );
      expect(screen.getByText("First")).toBeInTheDocument();
      expect(screen.queryByText("Second")).not.toBeInTheDocument();
    });

    it("should hide content for inactive steps", () => {
      render(
        <StepPanel index={0} activeStep={1}>
          Hidden
        </StepPanel>
      );
      expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    });

    it("should have correct aria attributes", () => {
      render(
        <StepPanel index={2} activeStep={2}>
          Content
        </StepPanel>
      );
      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAttribute("id", "step-panel-2");
      expect(panel).toHaveAttribute("aria-labelledby", "step-2");
    });

    it("should forward ref", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <StepPanel ref={ref} index={0} activeStep={0}>
          Content
        </StepPanel>
      );
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("StepperNavigation", () => {
    const defaultNavProps = {
      onBack: jest.fn(),
      onNext: jest.fn() as jest.Mock<() => Promise<void>>,
      onReset: jest.fn(),
      isFirstStep: true,
      isLastStep: false,
      isComplete: false,
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should render Back and Next buttons", () => {
      render(<StepperNavigation {...defaultNavProps} />);
      expect(screen.getByText("Back")).toBeInTheDocument();
      expect(screen.getByText("Next")).toBeInTheDocument();
    });

    it("should disable Back button on the first step", () => {
      render(<StepperNavigation {...defaultNavProps} isFirstStep={true} />);
      expect(screen.getByText("Back")).toBeDisabled();
    });

    it("should enable Back button on non-first steps", () => {
      render(<StepperNavigation {...defaultNavProps} isFirstStep={false} />);
      expect(screen.getByText("Back")).toBeEnabled();
    });

    it("should show Finish label on the last step", () => {
      render(<StepperNavigation {...defaultNavProps} isLastStep={true} />);
      expect(screen.getByText("Finish")).toBeInTheDocument();
    });

    it("should show Reset button when complete", () => {
      render(<StepperNavigation {...defaultNavProps} isComplete={true} />);
      expect(screen.getByText("Reset")).toBeInTheDocument();
      expect(screen.queryByText("Back")).not.toBeInTheDocument();
      expect(screen.queryByText("Next")).not.toBeInTheDocument();
    });

    it("should call onNext when Next is clicked", async () => {
      render(<StepperNavigation {...defaultNavProps} />);
      await userEvent.click(screen.getByText("Next"));
      expect(defaultNavProps.onNext).toHaveBeenCalledTimes(1);
    });

    it("should call onBack when Back is clicked", async () => {
      render(<StepperNavigation {...defaultNavProps} isFirstStep={false} />);
      await userEvent.click(screen.getByText("Back"));
      expect(defaultNavProps.onBack).toHaveBeenCalledTimes(1);
    });

    it("should call onReset when Reset is clicked", async () => {
      render(<StepperNavigation {...defaultNavProps} isComplete={true} />);
      await userEvent.click(screen.getByText("Reset"));
      expect(defaultNavProps.onReset).toHaveBeenCalledTimes(1);
    });

    it("should accept custom button labels", () => {
      render(
        <StepperNavigation
          {...defaultNavProps}
          backLabel="Previous"
          nextLabel="Continue"
        />
      );
      expect(screen.getByText("Previous")).toBeInTheDocument();
      expect(screen.getByText("Continue")).toBeInTheDocument();
    });

    it("should disable all buttons when disabled prop is true", () => {
      render(
        <StepperNavigation
          {...defaultNavProps}
          isFirstStep={false}
          disabled={true}
        />
      );
      expect(screen.getByText("Back")).toBeDisabled();
      expect(screen.getByText("Next")).toBeDisabled();
    });

    it("should forward ref", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<StepperNavigation ref={ref} {...defaultNavProps} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("useStepper", () => {
    it("should start on the first step", () => {
      render(<UseStepperExample />);
      expect(screen.getByText("Step One Content")).toBeInTheDocument();
      expect(screen.queryByText("Step Two Content")).not.toBeInTheDocument();
    });

    it("should advance to the next step when Next is clicked", async () => {
      render(<UseStepperExample />);
      await userEvent.click(screen.getByText("Next"));
      expect(screen.queryByText("Step One Content")).not.toBeInTheDocument();
      expect(screen.getByText("Step Two Content")).toBeInTheDocument();
    });

    it("should go back to the previous step when Back is clicked", async () => {
      render(<UseStepperExample />);
      await userEvent.click(screen.getByText("Next"));
      expect(screen.getByText("Step Two Content")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Back"));
      expect(screen.getByText("Step One Content")).toBeInTheDocument();
    });

    it("should not go back past the first step", async () => {
      render(<UseStepperExample />);
      expect(screen.getByText("Back")).toBeDisabled();
      expect(screen.getByText("Step One Content")).toBeInTheDocument();
    });

    it("should show Finish on the last step and complete the workflow", async () => {
      const onComplete = jest.fn();
      render(<UseStepperExample onComplete={onComplete} />);

      await userEvent.click(screen.getByText("Next"));
      await userEvent.click(screen.getByText("Next"));
      expect(screen.getByText("Finish")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Finish"));
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Reset")).toBeInTheDocument();
    });

    it("should reset to the first step when Reset is clicked", async () => {
      render(<UseStepperExample />);

      await userEvent.click(screen.getByText("Next"));
      await userEvent.click(screen.getByText("Next"));
      await userEvent.click(screen.getByText("Finish"));

      await userEvent.click(screen.getByText("Reset"));
      expect(screen.getByText("Step One Content")).toBeInTheDocument();
    });

    it("should call onStepChange when navigating", async () => {
      const onStepChange = jest.fn();
      render(<UseStepperExample onStepChange={onStepChange} />);

      await userEvent.click(screen.getByText("Next"));
      expect(onStepChange).toHaveBeenCalledWith(1);

      await userEvent.click(screen.getByText("Back"));
      expect(onStepChange).toHaveBeenCalledWith(0);
    });

    describe("Validation", () => {
      it("should block advancement when validate returns false", async () => {
        const steps: StepConfig[] = [
          { label: "Step One", validate: () => false },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        expect(screen.getByText("Step One Content")).toBeInTheDocument();
        expect(screen.getByTestId("validation-error")).toHaveTextContent(
          'Please complete "Step One" before continuing'
        );
      });

      it("should allow advancement when validate returns true", async () => {
        const steps: StepConfig[] = [
          { label: "Step One", validate: () => true },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        expect(screen.getByText("Step Two Content")).toBeInTheDocument();
      });

      it("should support async validation", async () => {
        const steps: StepConfig[] = [
          {
            label: "Step One",
            validate: () => Promise.resolve(true),
          },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        await waitFor(() => {
          expect(screen.getByText("Step Two Content")).toBeInTheDocument();
        });
      });

      it("should block advancement when async validation fails", async () => {
        const steps: StepConfig[] = [
          {
            label: "Step One",
            validate: () => Promise.resolve(false),
          },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        await waitFor(() => {
          expect(screen.getByText("Step One Content")).toBeInTheDocument();
        });
      });

      it("should handle validation errors gracefully", async () => {
        const steps: StepConfig[] = [
          {
            label: "Step One",
            validate: () => {
              throw new Error("boom");
            },
          },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        await waitFor(() => {
          expect(screen.getByTestId("validation-error")).toHaveTextContent(
            'Validation failed for "Step One"'
          );
        });
        expect(screen.getByText("Step One Content")).toBeInTheDocument();
      });

      it("should clear validation error when going back", async () => {
        const steps: StepConfig[] = [
          { label: "Step One" },
          { label: "Step Two", validate: () => false },
          { label: "Step Three" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        await userEvent.click(screen.getByText("Next"));
        expect(screen.getByTestId("validation-error")).toBeInTheDocument();

        await userEvent.click(screen.getByText("Back"));
        expect(
          screen.queryByTestId("validation-error")
        ).not.toBeInTheDocument();
      });

      it("should clear validation error on successful advancement", async () => {
        let shouldPass = false;
        const steps: StepConfig[] = [
          { label: "Step One", validate: () => shouldPass },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        expect(screen.getByTestId("validation-error")).toBeInTheDocument();

        shouldPass = true;
        await userEvent.click(screen.getByText("Next"));
        expect(
          screen.queryByTestId("validation-error")
        ).not.toBeInTheDocument();
        expect(screen.getByText("Step Two Content")).toBeInTheDocument();
      });

      it("should skip validation when step has no validate function", async () => {
        render(<UseStepperExample />);
        await userEvent.click(screen.getByText("Next"));
        expect(screen.getByText("Step Two Content")).toBeInTheDocument();
        expect(
          screen.queryByTestId("validation-error")
        ).not.toBeInTheDocument();
      });

      it("should include the step config in the validation error", async () => {
        const steps: StepConfig[] = [
          {
            label: "Step One",
            description: "First step",
            validate: () => false,
          },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        expect(lastValidationError).not.toBeNull();
        expect(lastValidationError!.step).toBe(steps[0]);
        expect(lastValidationError!.step.label).toBe("Step One");
        expect(lastValidationError!.step.description).toBe("First step");
        expect(lastValidationError!.message).toBe(
          'Please complete "Step One" before continuing'
        );
      });

      it("should use custom error message when validate returns a string", async () => {
        const steps: StepConfig[] = [
          {
            label: "Step One",
            validate: () => "Name is required",
          },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        expect(screen.getByTestId("validation-error")).toHaveTextContent(
          "Name is required"
        );
        expect(lastValidationError!.step).toBe(steps[0]);
        expect(lastValidationError!.message).toBe("Name is required");
      });

      it("should use custom error message from async validate returning a string", async () => {
        const steps: StepConfig[] = [
          {
            label: "Step One",
            validate: () => Promise.resolve("Email is invalid"),
          },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        await waitFor(() => {
          expect(lastValidationError!.message).toBe("Email is invalid");
          expect(lastValidationError!.step).toBe(steps[0]);
        });
        expect(screen.getByText("Step One Content")).toBeInTheDocument();
      });

      it("should include the step config when validation throws", async () => {
        const steps: StepConfig[] = [
          {
            label: "Step One",
            validate: () => {
              throw new Error("boom");
            },
          },
          { label: "Step Two" },
        ];
        render(<UseStepperExample steps={steps} />);

        await userEvent.click(screen.getByText("Next"));
        await waitFor(() => {
          expect(lastValidationError).not.toBeNull();
        });
        expect(lastValidationError!.step).toBe(steps[0]);
        expect(lastValidationError!.message).toBe(
          'Validation failed for "Step One"'
        );
      });
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref on Stepper", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Stepper ref={ref} steps={basicSteps} activeStep={0} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});
