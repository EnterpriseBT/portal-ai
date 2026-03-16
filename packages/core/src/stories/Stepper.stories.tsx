import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Typography from "@mui/material/Typography";
import {
  Stepper,
  StepPanel,
  StepperNavigation,
  useStepper,
  type StepConfig,
} from "../ui/Stepper";
import { TextInput } from "../ui/TextInput";

const meta = {
  title: "Components/Stepper",
  component: Stepper,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    orientation: {
      control: "select",
      options: ["horizontal", "vertical"],
      description: "The orientation of the stepper",
    },
    alternativeLabel: {
      control: "boolean",
      description: "Whether to place labels below the step icons",
    },
  },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof Stepper>;

const BasicExample = () => {
  const steps: StepConfig[] = [
    { label: "Account" },
    { label: "Profile" },
    { label: "Review" },
  ];

  const { stepperProps, getStepPanelProps, navigationProps } = useStepper({
    steps,
    onComplete: () => window.alert("All steps complete!"),
  });

  return (
    <div style={{ width: 500 }}>
      <Stepper {...stepperProps}>
        <StepPanel {...getStepPanelProps(0)}>
          <Typography>Create your account credentials.</Typography>
        </StepPanel>
        <StepPanel {...getStepPanelProps(1)}>
          <Typography>Fill in your profile details.</Typography>
        </StepPanel>
        <StepPanel {...getStepPanelProps(2)}>
          <Typography>Review your information and submit.</Typography>
        </StepPanel>
      </Stepper>
      <StepperNavigation {...navigationProps} />
    </div>
  );
};

export const Default: Story = {
  render: () => <BasicExample />,
};

const WithValidationExample = () => {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");

  const steps: StepConfig[] = [
    {
      label: "Name",
      validate: () => name.trim().length > 0,
    },
    {
      label: "Email",
      validate: () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    },
    { label: "Confirm" },
  ];

  const { stepperProps, getStepPanelProps, navigationProps, validationError } =
    useStepper({ steps });

  return (
    <div style={{ width: 500 }}>
      <Stepper {...stepperProps}>
        <StepPanel {...getStepPanelProps(0)}>
          <TextInput
            label="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
        </StepPanel>
        <StepPanel {...getStepPanelProps(1)}>
          <TextInput
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
          />
        </StepPanel>
        <StepPanel {...getStepPanelProps(2)}>
          <Typography>
            Name: {name}
            <br />
            Email: {email}
          </Typography>
        </StepPanel>
      </Stepper>
      {validationError && (
        <Typography color="error" variant="body2" sx={{ mt: 1 }}>
          {validationError.message}
        </Typography>
      )}
      <StepperNavigation {...navigationProps} />
    </div>
  );
};

export const WithValidation: Story = {
  render: () => <WithValidationExample />,
};

const WithOptionalStepExample = () => {
  const steps: StepConfig[] = [
    { label: "Required Step" },
    { label: "Optional Step", optional: true },
    { label: "Final Step" },
  ];

  const { stepperProps, getStepPanelProps, navigationProps } = useStepper({
    steps,
  });

  return (
    <div style={{ width: 500 }}>
      <Stepper {...stepperProps}>
        <StepPanel {...getStepPanelProps(0)}>
          <Typography>This step is required.</Typography>
        </StepPanel>
        <StepPanel {...getStepPanelProps(1)}>
          <Typography>This step is optional — you can skip it.</Typography>
        </StepPanel>
        <StepPanel {...getStepPanelProps(2)}>
          <Typography>Final step of the workflow.</Typography>
        </StepPanel>
      </Stepper>
      <StepperNavigation {...navigationProps} />
    </div>
  );
};

export const WithOptionalStep: Story = {
  render: () => <WithOptionalStepExample />,
};

const AlternativeLabelExample = () => {
  const steps: StepConfig[] = [
    { label: "Select" },
    { label: "Configure" },
    { label: "Deploy" },
  ];

  const { stepperProps, getStepPanelProps, navigationProps } = useStepper({
    steps,
  });

  return (
    <div style={{ width: 500 }}>
      <Stepper {...stepperProps} alternativeLabel>
        <StepPanel {...getStepPanelProps(0)}>
          <Typography>Select your resource.</Typography>
        </StepPanel>
        <StepPanel {...getStepPanelProps(1)}>
          <Typography>Configure your settings.</Typography>
        </StepPanel>
        <StepPanel {...getStepPanelProps(2)}>
          <Typography>Deploy your changes.</Typography>
        </StepPanel>
      </Stepper>
      <StepperNavigation {...navigationProps} />
    </div>
  );
};

export const AlternativeLabel: Story = {
  render: () => <AlternativeLabelExample />,
};
