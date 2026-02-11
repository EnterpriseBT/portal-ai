import { render } from "@testing-library/react";
import { PublicLayout } from "../layouts/Public.layout";

describe("PublicLayout Component", () => {
  it("should match snapshot", () => {
    const { container } = render(
      <PublicLayout>
        <div>Test Content</div>
      </PublicLayout>,
    );

    expect(container.firstChild).toMatchSnapshot();
  });
});
