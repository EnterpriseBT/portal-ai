import { clipToLength, NAME_MAX_LENGTH } from "@portalai/core/contracts";

/**
 * A connector instance name the app builds for the user from a file name or a
 * workbook/sheet title, which they can't edit before commit. Clipped to the
 * name limit (#801) so a long title names the connector instead of failing
 * the commit.
 */
export function generatedConnectorName(
  title: string,
  fallback: string
): string {
  return clipToLength(title.trim() || fallback, NAME_MAX_LENGTH);
}
