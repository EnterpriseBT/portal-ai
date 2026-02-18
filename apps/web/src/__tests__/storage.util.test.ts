import { renderHook, act, waitFor } from "./test-utils";
import { jest } from "@jest/globals";
import { useStorage } from "../utils/storage.util";

describe("useStorage", () => {
  const TEST_KEY = "test-storage-key";
  const DEFAULT_VALUE = "default";

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  describe("LocalStorage (default)", () => {
    it("should return default value when storage is empty", () => {
      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      expect(result.current.value).toBe(DEFAULT_VALUE);
    });

    it("should load value from localStorage on initialization", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify("stored-value"));

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      expect(result.current.value).toBe("stored-value");
    });

    it("should save value to localStorage when changed", async () => {
      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      act(() => {
        result.current.setValue("new-value");
      });

      await waitFor(() => {
        expect(window.localStorage.getItem(TEST_KEY)).toBe(
          JSON.stringify("new-value")
        );
      });
    });

    it("should remove value from localStorage", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify("stored-value"));

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      act(() => {
        result.current.removeValue();
      });

      expect(window.localStorage.getItem(TEST_KEY)).toBeNull();
      expect(result.current.value).toBe(DEFAULT_VALUE);
    });

    it("should handle complex objects", async () => {
      const complexObject = { name: "test", nested: { value: 42 } };

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: complexObject,
        })
      );

      const newObject = { name: "updated", nested: { value: 100 } };

      act(() => {
        result.current.setValue(newObject);
      });

      await waitFor(() => {
        const stored = window.localStorage.getItem(TEST_KEY);
        expect(JSON.parse(stored!)).toEqual(newObject);
      });

      expect(result.current.value).toEqual(newObject);
    });
  });

  describe("SessionStorage", () => {
    it("should use sessionStorage when specified", async () => {
      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
          storageType: "session",
        })
      );

      act(() => {
        result.current.setValue("session-value");
      });

      await waitFor(() => {
        expect(window.sessionStorage.getItem(TEST_KEY)).toBe(
          JSON.stringify("session-value")
        );
      });

      expect(window.localStorage.getItem(TEST_KEY)).toBeNull();
    });

    it("should load from sessionStorage on initialization", () => {
      window.sessionStorage.setItem(TEST_KEY, JSON.stringify("session-stored"));

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
          storageType: "session",
        })
      );

      expect(result.current.value).toBe("session-stored");
    });

    it("should remove value from sessionStorage", () => {
      window.sessionStorage.setItem(TEST_KEY, JSON.stringify("session-value"));

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
          storageType: "session",
        })
      );

      act(() => {
        result.current.removeValue();
      });

      expect(window.sessionStorage.getItem(TEST_KEY)).toBeNull();
      expect(result.current.value).toBe(DEFAULT_VALUE);
    });
  });

  describe("Validator", () => {
    const isNumber = (value: unknown): value is number => {
      return typeof value === "number";
    };

    it("should use validator to validate stored value", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify(42));

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: 0,
          validator: isNumber,
        })
      );

      expect(result.current.value).toBe(42);
    });

    it("should use default value when validation fails", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify("not-a-number"));

      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: 0,
          validator: isNumber,
        })
      );

      expect(result.current.value).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Invalid stored value for key "${TEST_KEY}", using default value`
      );

      consoleWarnSpy.mockRestore();
    });

    it("should work without validator", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify("any-value"));

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      expect(result.current.value).toBe("any-value");
    });
  });

  describe("Error Handling", () => {
    it("should handle localStorage.getItem errors gracefully", () => {
      const originalGetItem = Storage.prototype.getItem;
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      Storage.prototype.getItem = jest.fn(() => {
        throw new Error("localStorage unavailable");
      });

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      expect(result.current.value).toBe(DEFAULT_VALUE);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Failed to read from localStorage:",
        expect.any(Error)
      );

      Storage.prototype.getItem = originalGetItem;
      consoleWarnSpy.mockRestore();
    });

    it("should handle localStorage.setItem errors gracefully", async () => {
      const originalSetItem = Storage.prototype.setItem;
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      Storage.prototype.setItem = jest.fn(() => {
        throw new Error("localStorage full");
      });

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      act(() => {
        result.current.setValue("new-value");
      });

      expect(result.current.value).toBe("new-value");

      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Failed to save to localStorage:",
          expect.any(Error)
        );
      });

      Storage.prototype.setItem = originalSetItem;
      consoleWarnSpy.mockRestore();
    });

    it("should handle removeValue errors gracefully", () => {
      const originalRemoveItem = Storage.prototype.removeItem;
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      window.localStorage.setItem(TEST_KEY, JSON.stringify("value"));

      Storage.prototype.removeItem = jest.fn(() => {
        throw new Error("removeItem failed");
      });

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      act(() => {
        result.current.removeValue();
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Failed to remove from localStorage:",
        expect.any(Error)
      );

      Storage.prototype.removeItem = originalRemoveItem;
      consoleWarnSpy.mockRestore();
    });

    it("should handle invalid JSON gracefully", () => {
      window.localStorage.setItem(TEST_KEY, "invalid-json{");

      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      expect(result.current.value).toBe(DEFAULT_VALUE);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Failed to read from localStorage:",
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe("SSR Compatibility", () => {
    it("should handle undefined window gracefully", () => {
      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      expect(result.current.value).toBeDefined();
      expect(result.current.setValue).toBeDefined();
      expect(result.current.removeValue).toBeDefined();
    });
  });

  describe("Return Value", () => {
    it("should return value, setValue, and removeValue", () => {
      const { result } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      expect(result.current).toHaveProperty("value");
      expect(result.current).toHaveProperty("setValue");
      expect(result.current).toHaveProperty("removeValue");
      expect(typeof result.current.setValue).toBe("function");
      expect(typeof result.current.removeValue).toBe("function");
    });

    it("should maintain stable function references", () => {
      const { result, rerender } = renderHook(() =>
        useStorage({
          key: TEST_KEY,
          defaultValue: DEFAULT_VALUE,
        })
      );

      const firstSetValue = result.current.setValue;
      const firstRemoveValue = result.current.removeValue;

      act(() => {
        result.current.setValue("new-value");
      });

      rerender();

      expect(result.current.setValue).toBe(firstSetValue);
      expect(result.current.removeValue).toBe(firstRemoveValue);
    });
  });
});
