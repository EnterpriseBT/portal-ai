/**
 * Validates an emitted `security.txt` (#613, RFC 9116) for `verify-pages.mjs`.
 *
 * Its own module so jest can import it: `verify-pages.mjs` runs its checks at
 * module top level against `dist/`.
 *
 * Returns failure messages; an empty array is a pass.
 */

/** Values of every `Name: value` line for one field. */
const field = (text, name) =>
  [...text.matchAll(new RegExp(`^${name}:[ \\t]*(.*)$`, "gim"))].map((m) =>
    m[1].trim()
  );

/**
 * @param {string} text
 * @param {{ now: Date, origin: string }} options
 * @returns {string[]}
 */
export function checkSecurityTxt(text, { now, origin }) {
  const problems = [];

  const contacts = field(text, "Contact");
  if (contacts.length !== 1 || !/^mailto:[^@\s]+@[^@\s]+$/.test(contacts[0])) {
    problems.push(
      `security.txt: needs exactly one Contact: mailto:<address>, found ${JSON.stringify(contacts)}`
    );
  }

  const expires = field(text, "Expires");
  if (expires.length !== 1) {
    problems.push(
      `security.txt: needs exactly one Expires, found ${expires.length}`
    );
  } else {
    const at = Date.parse(expires[0]);
    if (Number.isNaN(at)) {
      problems.push(`security.txt: Expires "${expires[0]}" does not parse`);
    } else if (at <= now.getTime()) {
      problems.push(`security.txt: Expires ${expires[0]} is not in the future`);
    }
  }

  for (const name of ["Canonical", "Policy"]) {
    for (const value of field(text, name)) {
      if (!value.startsWith(`${origin}/`)) {
        problems.push(
          `security.txt: ${name} ${value} is not on this build's origin ${origin}`
        );
      }
    }
  }

  return problems;
}
