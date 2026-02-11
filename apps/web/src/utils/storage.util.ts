import { useCallback, useEffect, useRef, useState } from "react";

export type StorageType = "local" | "session";

export interface UseStorageOptions<T> {
  key: string;
  defaultValue: T;
  storageType?: StorageType;
  validator?: (value: unknown) => value is T;
}

export interface UseStorageResult<T> {
  value: T;
  setValue: (value: T) => void;
  removeValue: () => void;
}

/**
 * Get the storage object based on storage type
 */
const getStorage = (type: StorageType): Storage | null => {
  if (typeof window === "undefined") return null;
  return type === "local" ? window.localStorage : window.sessionStorage;
};

/**
 * Custom hook to manage data persistence in localStorage or sessionStorage
 * @param options - Configuration options
 * @returns The current value, setter, and remover functions
 */
export const useStorage = <T>({
  key,
  defaultValue,
  storageType = "local",
  validator,
}: UseStorageOptions<T>): UseStorageResult<T> => {
  const isRemoving = useRef(false);

  const [value, setValue] = useState<T>(() => {
    const storage = getStorage(storageType);
    if (!storage) return defaultValue;

    try {
      const stored = storage.getItem(key);
      if (stored === null) return defaultValue;

      const parsed = JSON.parse(stored);

      // If validator is provided, use it to validate the stored value
      if (validator && !validator(parsed)) {
        console.warn(
          `Invalid stored value for key "${key}", using default value`
        );
        return defaultValue;
      }

      return parsed as T;
    } catch (error) {
      console.warn(`Failed to read from ${storageType}Storage:`, error);
      return defaultValue;
    }
  });

  useEffect(() => {
    // Skip saving if we're in the process of removing
    if (isRemoving.current) {
      isRemoving.current = false;
      return;
    }

    const storage = getStorage(storageType);
    if (!storage) return;

    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`Failed to save to ${storageType}Storage:`, error);
    }
  }, [key, value, storageType]);

  const removeValue = useCallback(() => {
    const storage = getStorage(storageType);
    if (!storage) return;

    try {
      storage.removeItem(key);
      isRemoving.current = true;
      setValue(defaultValue);
    } catch (error) {
      console.warn(`Failed to remove from ${storageType}Storage:`, error);
    }
  }, [key, defaultValue, storageType]);

  return { value, setValue, removeValue };
};
