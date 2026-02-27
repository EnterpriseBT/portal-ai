import type { Meta, StoryObj } from "@storybook/react";
import {
  DataResult,
  DataResultProps,
  QueryResultLike,
  ResultsMap,
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

const meta = {
  title: "Components/DataResult",
  component: DataResult,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    loadingMessage: {
      control: "text",
      description: "Global default message displayed while loading",
    },
  },
} satisfies Meta<typeof DataResult>;

export default meta;
type Story = StoryObj<DataResultProps<ResultsMap>>;

export const Loading: Story = {
  args: {
    results: {
      data: makeQuery({ isLoading: true }),
    },
    children: () => <div>Loaded</div>,
    loadingMessage: "Loading data...",
  },
};

export const Error: Story = {
  args: {
    results: {
      user: makeQuery({
        isError: true,
        error: new globalThis.Error("Failed to fetch user data"),
      }),
    },
    children: () => <div>Loaded</div>,
  },
};

export const SingleSuccess: Story = {
  args: {
    results: {
      user: makeQuery({ data: { name: "Alice" }, isSuccess: true }),
    },
    children: (data) => (
      <div>User: {(data.user as { name: string }).name}</div>
    ),
  },
};

export const MultipleSuccess: Story = {
  args: {
    results: {
      users: makeQuery({ data: "Users loaded", isSuccess: true }),
      posts: makeQuery({ data: "Posts loaded", isSuccess: true }),
      comments: makeQuery({ data: "Comments loaded", isSuccess: true }),
    },
    children: (data) => (
      <ul>
        {Object.entries(data).map(([key, value]) => (
          <li key={key}>{String(value)}</li>
        ))}
      </ul>
    ),
  },
};

export const PartialLoading: Story = {
  args: {
    results: {
      users: makeQuery({ data: "Users loaded", isSuccess: true }),
      posts: makeQuery({ isLoading: true }),
    },
    children: (data) => <div>{String(data.users)}</div>,
    loadingMessage: "Still loading some data...",
  },
};

export const FirstErrorWins: Story = {
  args: {
    results: {
      auth: makeQuery({
        isError: true,
        error: new globalThis.Error("Auth failed"),
      }),
      network: makeQuery({
        isError: true,
        error: new globalThis.Error("Network timeout"),
      }),
    },
    children: () => <div>Loaded</div>,
  },
};

export const CustomErrorMessage: Story = {
  args: {
    results: {
      users: makeQuery({
        isError: true,
        error: new globalThis.Error("500 Internal Server Error"),
      }),
    },
    options: {
      users: { errorMessage: "Failed to load users" },
    },
    children: () => <div>Loaded</div>,
  },
};

export const CustomRenderError: Story = {
  args: {
    results: {
      users: makeQuery({
        isError: true,
        error: new globalThis.Error("Something went wrong"),
      }),
    },
    options: {
      users: {
        renderError: (error) => (
          <div style={{ color: "red", padding: 16 }}>
            Custom Error: {error.message}
          </div>
        ),
      },
    },
    children: () => <div>Loaded</div>,
  },
};

export const CustomRenderLoading: Story = {
  args: {
    results: {
      users: makeQuery({ isLoading: true }),
    },
    options: {
      users: {
        renderLoading: () => (
          <div style={{ padding: 16, fontStyle: "italic" }}>
            Custom skeleton loader...
          </div>
        ),
      },
    },
    children: () => <div>Loaded</div>,
  },
};
