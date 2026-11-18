import { screen } from "@testing-library/react";

import {
  EMPTY_LIST_HELP,
  emptyListHelp,
  type EmptyList,
} from "../utils/empty-list-help.util";

/** #1059: the empty list shows its sentence and links to its Help entry. */
export function expectEmptyListHelp(list: EmptyList): void {
  expect(
    screen.getByText(EMPTY_LIST_HELP[list].description)
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: EMPTY_LIST_HELP[list].faq })
  ).toHaveAttribute("href", emptyListHelp(list).helpLink.href);
}

/**
 * #1059: a search that matches nothing keeps the "no results" state, not the
 * explainer. Types into the list's search box and waits for the debounce.
 */
export async function expectFilteredEmptyKeepsNoResults(
  list: EmptyList
): Promise<void> {
  const { default: userEvent } = await import("@testing-library/user-event");
  await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "zzz");
  expect(await screen.findByText(/No results found/)).toBeInTheDocument();
  expect(screen.queryByText(EMPTY_LIST_HELP[list].description)).toBeNull();
}
