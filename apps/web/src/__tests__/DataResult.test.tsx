import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import {
  DataResult,
  QueryResultLike,
} from "../components/DataResult.component";

const makeQuery = <T,>(
  overrides: Partial<QueryResultLike<T>> = {}
): QueryResultLike<T> => ({
  data: undefined,
  error: null,
  isLoading: false,
  isError: false,
  isSuccess: false,
  ...overrides,
});

const successQuery = <T,>(data: T): QueryResultLike<T> =>
  makeQuery<T>({ data, isSuccess: true });

const loadingQuery = (): QueryResultLike<never> =>
  makeQuery<never>({ isLoading: true });

const errorQuery = (message: string): QueryResultLike<never> =>
  makeQuery<never>({ error: new Error(message), isError: true });

describe("DataResult Component", () => {
  describe("Loading State", () => {
    it("should show loading when a single result is loading", () => {
      render(
        <DataResult results={{ item: loadingQuery() }}>
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
      expect(screen.queryByText("Done")).not.toBeInTheDocument();
    });

    it("should show loading when any result is loading", () => {
      render(
        <DataResult
          results={{
            a: successQuery("a"),
            b: loadingQuery(),
            c: successQuery("c"),
          }}
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.queryByText("Done")).not.toBeInTheDocument();
    });

    it("should use global custom loading message", () => {
      render(
        <DataResult
          results={{ item: loadingQuery() }}
          loadingMessage="Fetching data..."
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByText("Fetching data...")).toBeInTheDocument();
    });

    it("should use per-key loadingMessage over global default", () => {
      render(
        <DataResult
          results={{ item: loadingQuery() }}
          options={{ item: { loadingMessage: "Loading item..." } }}
          loadingMessage="Global loading..."
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByText("Loading item...")).toBeInTheDocument();
      expect(screen.queryByText("Global loading...")).not.toBeInTheDocument();
    });

    it("should use per-key renderLoading when provided", () => {
      render(
        <DataResult
          results={{ item: loadingQuery() }}
          options={{
            item: {
              renderLoading: () => (
                <div data-testid="custom-loader">Custom Loading</div>
              ),
            },
          }}
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByTestId("custom-loader")).toBeInTheDocument();
      expect(screen.getByText("Custom Loading")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    it("should show error when a single result has an error", () => {
      render(
        <DataResult results={{ item: errorQuery("Network failure") }}>
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByText("Network failure")).toBeInTheDocument();
      expect(screen.queryByText("Done")).not.toBeInTheDocument();
    });

    it("should show the first error when multiple results have errors", () => {
      render(
        <DataResult
          results={{
            first: errorQuery("First error"),
            second: errorQuery("Second error"),
          }}
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByText("First error")).toBeInTheDocument();
      expect(screen.queryByText("Second error")).not.toBeInTheDocument();
    });

    it("should prioritize errors over loading", () => {
      render(
        <DataResult
          results={{
            err: errorQuery("Something broke"),
            load: loadingQuery(),
          }}
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByText("Something broke")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("should use per-key errorMessage when provided", () => {
      render(
        <DataResult
          results={{ item: errorQuery("raw error") }}
          options={{ item: { errorMessage: "Failed to load items" } }}
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByText("Failed to load items")).toBeInTheDocument();
      expect(screen.queryByText("raw error")).not.toBeInTheDocument();
    });

    it("should use per-key renderError when provided", () => {
      render(
        <DataResult
          results={{ item: errorQuery("raw error") }}
          options={{
            item: {
              renderError: (error) => (
                <div data-testid="custom-error">Custom: {error.message}</div>
              ),
            },
          }}
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByTestId("custom-error")).toBeInTheDocument();
      expect(screen.getByText("Custom: raw error")).toBeInTheDocument();
    });

    it("should prioritize renderError over errorMessage", () => {
      render(
        <DataResult
          results={{ item: errorQuery("raw error") }}
          options={{
            item: {
              errorMessage: "Should not appear",
              renderError: (error) => <div>Render: {error.message}</div>,
            },
          }}
        >
          {() => <div>Done</div>}
        </DataResult>
      );
      expect(screen.getByText("Render: raw error")).toBeInTheDocument();
      expect(screen.queryByText("Should not appear")).not.toBeInTheDocument();
    });
  });

  describe("Success State", () => {
    it("should call children with data map for a single result", () => {
      const childrenFn = jest.fn(({ item }: { item: string }) => (
        <div>Result: {item}</div>
      ));
      render(
        <DataResult results={{ item: successQuery("hello") }}>
          {childrenFn}
        </DataResult>
      );
      expect(childrenFn).toHaveBeenCalledWith({ item: "hello" });
      expect(screen.getByText("Result: hello")).toBeInTheDocument();
    });

    it("should call children with data map for multiple results", () => {
      const childrenFn = jest.fn(
        ({ one, two, three }: { one: string; two: string; three: string }) => (
          <div>
            {one}, {two}, {three}
          </div>
        )
      );
      render(
        <DataResult
          results={{
            one: successQuery("one"),
            two: successQuery("two"),
            three: successQuery("three"),
          }}
        >
          {childrenFn}
        </DataResult>
      );
      expect(childrenFn).toHaveBeenCalledWith({
        one: "one",
        two: "two",
        three: "three",
      });
      expect(screen.getByText("one, two, three")).toBeInTheDocument();
    });
  });

  describe("Custom Props", () => {
    it("should pass className to StatusMessage when loading", () => {
      const { container } = render(
        <DataResult
          results={{ item: loadingQuery() }}
          className="custom-class"
        >
          {() => <div />}
        </DataResult>
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });

    it("should pass data attributes to StatusMessage when errored", () => {
      render(
        <DataResult
          results={{ item: errorQuery("fail") }}
          data-testid="data-result"
        >
          {() => <div />}
        </DataResult>
      );
      expect(screen.getByTestId("data-result")).toBeInTheDocument();
    });
  });
});
