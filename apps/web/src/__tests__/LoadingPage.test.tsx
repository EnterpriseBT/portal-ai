import { render } from "@testing-library/react";
import { LoadingPage } from "../pages/Loading.page";

describe("LoadingPage Component", () => {
  it("should match snapshot", () => {
    const { container } = render(<LoadingPage />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
