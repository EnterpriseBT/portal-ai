import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import { SyncTotal } from "../components/SyncTotal.component";

describe("SyncTotal", () => {
  it("should call setTotal when total is defined", () => {
    const setTotal = jest.fn();
    render(
      <SyncTotal total={42} setTotal={setTotal}>
        <div>content</div>
      </SyncTotal>
    );
    expect(setTotal).toHaveBeenCalledWith(42);
  });

  it("should not call setTotal when total is undefined", () => {
    const setTotal = jest.fn();
    render(
      <SyncTotal total={undefined} setTotal={setTotal}>
        <div>content</div>
      </SyncTotal>
    );
    expect(setTotal).not.toHaveBeenCalled();
  });

  it("should render children", () => {
    const setTotal = jest.fn();
    render(
      <SyncTotal total={10} setTotal={setTotal}>
        <div>child content</div>
      </SyncTotal>
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("should call setTotal again when total changes", () => {
    const setTotal = jest.fn();
    const { rerender } = render(
      <SyncTotal total={5} setTotal={setTotal}>
        <div>content</div>
      </SyncTotal>
    );
    expect(setTotal).toHaveBeenCalledWith(5);

    setTotal.mockClear();
    rerender(
      <SyncTotal total={20} setTotal={setTotal}>
        <div>content</div>
      </SyncTotal>
    );
    expect(setTotal).toHaveBeenCalledWith(20);
  });

  it("should call setTotal with 0", () => {
    const setTotal = jest.fn();
    render(
      <SyncTotal total={0} setTotal={setTotal}>
        <div>content</div>
      </SyncTotal>
    );
    expect(setTotal).toHaveBeenCalledWith(0);
  });
});
