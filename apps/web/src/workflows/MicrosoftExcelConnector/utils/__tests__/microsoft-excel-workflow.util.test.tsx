import { jest, describe, it, expect } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  MICROSOFT_EXCEL_WORKFLOW_STEPS,
  useMicrosoftExcelWorkflow,
} from "../microsoft-excel-workflow.util";
import type { MicrosoftExcelWorkflowCallbacks } from "../microsoft-excel-workflow.util";

function makeCallbacks(
  overrides: Partial<MicrosoftExcelWorkflowCallbacks> = {}
): MicrosoftExcelWorkflowCallbacks {
  return {
    loadWorkbook: jest.fn(async () => ({
      title: "Q3 Forecast",
      sheets: [
        {
          id: "sheet_0_q3",
          name: "Q3",
          dimensions: { rows: 1, cols: 1 },
          cells: [["hello"]],
        },
      ],
    })) as MicrosoftExcelWorkflowCallbacks["loadWorkbook"],
    runInterpret: jest.fn() as MicrosoftExcelWorkflowCallbacks["runInterpret"],
    runCommit: jest.fn() as MicrosoftExcelWorkflowCallbacks["runCommit"],
    ...overrides,
  };
}

describe("MICROSOFT_EXCEL_WORKFLOW_STEPS", () => {
  it("declares the four expected step labels", () => {
    expect(MICROSOFT_EXCEL_WORKFLOW_STEPS.map((s) => s.label)).toEqual([
      "Authorize",
      "Choose workbook",
      "Draw regions",
      "Review",
    ]);
  });
});

describe("useMicrosoftExcelWorkflow", () => {
  it("starts at step 0 (Authorize) with no instance or workbook", () => {
    const { result } = renderHook(() =>
      useMicrosoftExcelWorkflow(makeCallbacks())
    );
    expect(result.current.step).toBe(0);
    expect(result.current.connectorInstanceId).toBeNull();
    expect(result.current.workbook).toBeNull();
  });

  it("setAuthorized advances to step 1 (Choose workbook) and stores account info", () => {
    const { result } = renderHook(() =>
      useMicrosoftExcelWorkflow(makeCallbacks())
    );
    act(() => {
      result.current.setAuthorized({
        connectorInstanceId: "ci-1",
        accountInfo: { identity: "alice@contoso.com", metadata: {} },
      });
    });
    expect(result.current.step).toBe(1);
    expect(result.current.connectorInstanceId).toBe("ci-1");
    expect(result.current.accountInfo?.identity).toBe("alice@contoso.com");
  });

  it("selectWorkbook calls loadWorkbook with the active connector instance + drive item", async () => {
    const loadWorkbook = jest.fn(async () => ({
      title: "Q3",
      sheets: [
        {
          id: "sheet_0_q3",
          name: "Q3",
          dimensions: { rows: 1, cols: 1 },
          cells: [["x"]],
        },
      ],
    }));
    const { result } = renderHook(() =>
      useMicrosoftExcelWorkflow(
        makeCallbacks({
          loadWorkbook:
            loadWorkbook as MicrosoftExcelWorkflowCallbacks["loadWorkbook"],
        })
      )
    );
    act(() => {
      result.current.setAuthorized({
        connectorInstanceId: "ci-1",
        accountInfo: { identity: "alice@contoso.com", metadata: {} },
      });
    });
    await act(async () => {
      await result.current.selectWorkbook("01ABC");
    });
    expect(loadWorkbook).toHaveBeenCalledWith({
      connectorInstanceId: "ci-1",
      driveItemId: "01ABC",
    });
    await waitFor(() => {
      expect(result.current.workbook).not.toBeNull();
    });
    // Workbook seeded → core advances to draw phase → step 2.
    expect(result.current.step).toBe(2);
    expect(result.current.driveItemId).toBe("01ABC");
  });

  it("reset clears connector instance + workbook + account info", () => {
    const { result } = renderHook(() =>
      useMicrosoftExcelWorkflow(makeCallbacks())
    );
    act(() => {
      result.current.setAuthorized({
        connectorInstanceId: "ci-1",
        accountInfo: { identity: "alice@contoso.com", metadata: {} },
      });
    });
    expect(result.current.step).toBe(1);
    act(() => {
      result.current.reset();
    });
    expect(result.current.step).toBe(0);
    expect(result.current.connectorInstanceId).toBeNull();
    expect(result.current.accountInfo).toBeNull();
  });

  it("surfaces a serverError when loadWorkbook throws", async () => {
    const loadWorkbook = jest.fn(async () => {
      throw new Error("Graph rejected the download");
    });
    const { result } = renderHook(() =>
      useMicrosoftExcelWorkflow(
        makeCallbacks({
          loadWorkbook:
            loadWorkbook as MicrosoftExcelWorkflowCallbacks["loadWorkbook"],
        })
      )
    );
    act(() => {
      result.current.setAuthorized({
        connectorInstanceId: "ci-1",
        accountInfo: { identity: "alice@contoso.com", metadata: {} },
      });
    });
    await act(async () => {
      await result.current.selectWorkbook("01ABC");
    });
    await waitFor(() => {
      expect(result.current.serverError).not.toBeNull();
    });
    expect(result.current.serverError?.message).toMatch(/graph rejected/i);
  });
});
