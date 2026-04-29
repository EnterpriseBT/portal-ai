import "@testing-library/jest-dom";
import { jest } from "@jest/globals";

// Mock the heavy RegionDrawingStepUI before importing the component
// under test (ESM: mock declarations must precede dynamic imports).
jest.unstable_mockModule("../../../modules/RegionEditor", () => ({
  RegionDrawingStepUI: (props: Record<string, unknown>) => (
    <div data-testid="region-drawing-step-ui">
      loadSlice:{typeof props.loadSlice}
    </div>
  ),
}));

const { render, screen } = await import("../../../__tests__/test-utils");
const { GoogleSheetsRegionDrawingStep } = await import(
  "../GoogleSheetsRegionDrawingStep.component"
);
type GoogleSheetsRegionDrawingStepUIProps = React.ComponentProps<
  typeof GoogleSheetsRegionDrawingStep
>;

function makeProps(
  overrides: Partial<GoogleSheetsRegionDrawingStepUIProps> = {}
): GoogleSheetsRegionDrawingStepUIProps {
  return {
    workbook: {} as never,
    columnDefinitions: [],
    onColumnDefinitionsChange: jest.fn(),
    regions: [],
    onRegionsChange: jest.fn(),
    bindings: {},
    onBindingsChange: jest.fn(),
    loadSlice: jest.fn(async () => []),
    serverError: null,
    ...overrides,
  } as unknown as GoogleSheetsRegionDrawingStepUIProps;
}

describe("GoogleSheetsRegionDrawingStep", () => {
  it("forwards loadSlice (and other props) to the underlying RegionDrawingStepUI", () => {
    render(<GoogleSheetsRegionDrawingStep {...makeProps()} />);
    const inner = screen.getByTestId("region-drawing-step-ui");
    expect(inner).toHaveTextContent(/loadSlice:function/);
  });

  it("renders FormAlert when serverError is set", () => {
    render(
      <GoogleSheetsRegionDrawingStep
        {...makeProps({
          serverError: { message: "interpret failed", code: "X" },
        })}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/interpret failed/i);
  });

  it("does not render FormAlert when serverError is null", () => {
    render(<GoogleSheetsRegionDrawingStep {...makeProps({ serverError: null })} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
