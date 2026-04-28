import { jest } from "@jest/globals";
import type { QueryResultLike } from "../components/DataResult.component";
import type { HealthGetResponse } from "@portalai/core/contracts";

const makeQuery = (
  overrides: Partial<QueryResultLike<HealthGetResponse>> = {}
): QueryResultLike<HealthGetResponse> => ({
  data: undefined,
  error: null,
  isLoading: false,
  isError: false,
  isSuccess: false,
  ...overrides,
});

let currentQuery: QueryResultLike<HealthGetResponse> = makeQuery();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    health: {
      check: () => currentQuery,
    },
  },
}));

const { render, screen, waitFor } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { HealthCheck, HealthCheckUI } =
  await import("../components/HealthCheck.component");

describe("HealthCheckUI Component", () => {
  it("should render a green indicator", () => {
    render(
      <HealthCheckUI
        data={{
          timestamp: "2026-02-27T12:00:00.000Z",
          version: "v1.0.0",
          sha: "abc1234",
        }}
        data-testid="health"
      />
    );
    expect(screen.getByTestId("health")).toBeInTheDocument();
  });

  it("should show healthy tooltip with timestamp on hover", async () => {
    render(
      <HealthCheckUI
        data={{
          timestamp: "2026-02-27T12:00:00.000Z",
          version: "v1.0.0",
          sha: "abc1234",
        }}
        data-testid="health"
      />
    );
    await userEvent.hover(screen.getByTestId("health"));
    await waitFor(() => {
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip.textContent).toMatch(/Healthy/);
      expect(tooltip.textContent).toMatch(/last checked/);
    });
  });

  it("should show 'unknown' when timestamp is empty", async () => {
    render(
      <HealthCheckUI
        data={{ timestamp: "", version: "dev", sha: "unknown" }}
        data-testid="health"
      />
    );
    await userEvent.hover(screen.getByTestId("health"));
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("unknown");
    });
  });

  it("should pass className", () => {
    render(
      <HealthCheckUI
        data={{ timestamp: "", version: "dev", sha: "unknown" }}
        className="my-class"
        data-testid="health"
      />
    );
    expect(screen.getByTestId("health")).toHaveClass("my-class");
  });

  it("should pass data attributes", () => {
    render(
      <HealthCheckUI
        data={{ timestamp: "", version: "dev", sha: "unknown" }}
        data-testid="health-indicator"
      />
    );
    expect(screen.getByTestId("health-indicator")).toBeInTheDocument();
  });
});

describe("HealthCheck Component", () => {
  beforeEach(() => {
    currentQuery = makeQuery();
  });

  describe("Success State", () => {
    it("should render a green indicator", () => {
      currentQuery = makeQuery({
        data: {
          timestamp: "2026-02-27T12:00:00.000Z",
          version: "v1.0.0",
          sha: "abc1234",
        },
        isSuccess: true,
      });
      render(<HealthCheck data-testid="health" />);
      expect(screen.getByTestId("health")).toBeInTheDocument();
    });

    it("should show healthy tooltip with timestamp on hover", async () => {
      currentQuery = makeQuery({
        data: {
          timestamp: "2026-02-27T12:00:00.000Z",
          version: "v1.0.0",
          sha: "abc1234",
        },
        isSuccess: true,
      });
      render(<HealthCheck data-testid="health" />);
      await userEvent.hover(screen.getByTestId("health"));
      await waitFor(() => {
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip.textContent).toMatch(/Healthy/);
        expect(tooltip.textContent).toMatch(/last checked/);
      });
    });
  });

  describe("Loading State", () => {
    it("should render an indicator", () => {
      currentQuery = makeQuery({ isLoading: true });
      render(<HealthCheck data-testid="health" />);
      expect(screen.getByTestId("health")).toBeInTheDocument();
    });

    it("should show checking tooltip on hover", async () => {
      currentQuery = makeQuery({ isLoading: true });
      render(<HealthCheck data-testid="health" />);
      await userEvent.hover(screen.getByTestId("health"));
      await waitFor(() => {
        expect(screen.getByRole("tooltip")).toHaveTextContent(
          "Checking health..."
        );
      });
    });
  });

  describe("Error State", () => {
    it("should render an indicator", () => {
      currentQuery = makeQuery({
        isError: true,
        error: new Error("Connection refused"),
      });
      render(<HealthCheck data-testid="health" />);
      expect(screen.getByTestId("health")).toBeInTheDocument();
    });

    it("should show error message in tooltip on hover", async () => {
      currentQuery = makeQuery({
        isError: true,
        error: new Error("Connection refused"),
      });
      render(<HealthCheck data-testid="health" />);
      await userEvent.hover(screen.getByTestId("health"));
      await waitFor(() => {
        expect(screen.getByRole("tooltip")).toHaveTextContent(
          "Connection refused"
        );
      });
    });
  });

  describe("Custom Props", () => {
    it("should pass className", () => {
      currentQuery = makeQuery({
        isSuccess: true,
        data: { timestamp: "", version: "dev", sha: "unknown" },
      });
      render(<HealthCheck className="my-class" data-testid="health" />);
      expect(screen.getByTestId("health")).toHaveClass("my-class");
    });

    it("should pass data attributes", () => {
      currentQuery = makeQuery({
        isSuccess: true,
        data: { timestamp: "", version: "dev", sha: "unknown" },
      });
      render(<HealthCheck data-testid="health-indicator" />);
      expect(screen.getByTestId("health-indicator")).toBeInTheDocument();
    });
  });
});
