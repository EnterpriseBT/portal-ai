import React from "react";
import { describe, it, expect } from "@jest/globals";

import { Modal } from "../../ui/Modal";

const noop = () => {};

// #789: a form Modal can't leave out what makes Enter honest. These
// assertions are checked by `npm run type-check`; the runtime test only
// keeps the file in the suite.
describe("Modal props (type-level)", () => {
  it("compiles the valid shapes and rejects the invalid ones", () => {
    const valid = [
      <Modal
        key="form"
        title="T"
        open
        onClose={noop}
        onSubmit={noop}
        submitDisabled={false}
        pending={false}
      />,
      <Modal key="plain" title="T" open onClose={noop} />,
      <Modal key="plain-pending" title="T" open onClose={noop} pending />,
    ];

    const invalid = [
      // @ts-expect-error onSubmit requires submitDisabled
      <Modal
        key="a"
        title="T"
        open
        onClose={noop}
        onSubmit={noop}
        pending={false}
      />,
      // @ts-expect-error onSubmit requires pending
      <Modal
        key="b"
        title="T"
        open
        onClose={noop}
        onSubmit={noop}
        submitDisabled={false}
      />,
      // @ts-expect-error submitDisabled is only for a form Modal
      <Modal key="c" title="T" open onClose={noop} submitDisabled={false} />,
    ];

    expect(valid).toHaveLength(3);
    expect(invalid).toHaveLength(3);
  });
});

// #793: every dialog has a name, its title or an aria-label, never both.
describe("Modal name (type-level)", () => {
  it("requires a title or an aria-label", () => {
    const valid = [
      <Modal key="t" open onClose={noop} title="Rename" />,
      <Modal key="l" open onClose={noop} aria-label="Pick a sheet" />,
    ];
    const invalid = [
      // @ts-expect-error a dialog needs a name
      <Modal key="none" open onClose={noop} />,
      // @ts-expect-error a title names it already
      <Modal key="both" open onClose={noop} title="T" aria-label="L" />,
    ];
    expect(valid).toHaveLength(2);
    expect(invalid).toHaveLength(2);
  });
});
