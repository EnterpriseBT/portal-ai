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
        open
        onClose={noop}
        onSubmit={noop}
        submitDisabled={false}
        pending={false}
      />,
      <Modal key="plain" open onClose={noop} />,
      <Modal key="plain-pending" open onClose={noop} pending />,
    ];

    const invalid = [
      // @ts-expect-error onSubmit requires submitDisabled
      <Modal key="a" open onClose={noop} onSubmit={noop} pending={false} />,
      // @ts-expect-error onSubmit requires pending
      <Modal
        key="b"
        open
        onClose={noop}
        onSubmit={noop}
        submitDisabled={false}
      />,
      // @ts-expect-error submitDisabled is only for a form Modal
      <Modal key="c" open onClose={noop} submitDisabled={false} />,
    ];

    expect(valid).toHaveLength(3);
    expect(invalid).toHaveLength(3);
  });
});
