import { render } from "@testing-library/react";
import { LoadingView } from "../views/Loading.view";

describe("LoadingView Component", () => {
  it("should match snapshot", () => {
    const { container } = render(<LoadingView />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
