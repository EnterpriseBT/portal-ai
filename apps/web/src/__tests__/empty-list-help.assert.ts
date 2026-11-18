import { expect } from "@jest/globals";
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
    screen.getByRole("link", { name: `Help: ${EMPTY_LIST_HELP[list].faq}` })
  ).toHaveAttribute("href", emptyListHelp(list).helpLink.href);
}
