/**
 * Stub `ColumnDefinitionClassifier` used by adapter unit tests and the
 * slice-8 end-to-end probe integration test. Lets tests assert
 * caller-side merge behavior, degradation paths, and pLimit-ish
 * batching without invoking the real Haiku endpoint.
 *
 * Two factories:
 *   - `createStubClassifier(response)`  — returns `response` verbatim
 *     on every `classify` call.
 *   - `createThrowingClassifier(reason?)` — throws `ClassifierError`
 *     on every call so the adapter's degradation path can be
 *     exercised.
 */
import {
  ClassifierError,
  type ApiColumnClassification,
  type ColumnDefinitionClassifier,
  type ClassifierErrorReason,
} from "./classifier.types.js";

export function createStubClassifier(
  response: ApiColumnClassification[]
): ColumnDefinitionClassifier {
  return {
    async classify() {
      return response;
    },
  };
}

export function createThrowingClassifier(
  reason: ClassifierErrorReason = "network-error",
  message = "stub classifier failure"
): ColumnDefinitionClassifier {
  return {
    async classify() {
      throw new ClassifierError(reason, message);
    },
  };
}
