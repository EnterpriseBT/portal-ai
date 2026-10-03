import React from "react";

/**
 * The default (submit) button for a dialog form whose visible actions are all
 * `type="button"`.
 *
 * Dialog actions are `type="button"` so a click can't fire both the button's
 * handler and the form's submit. But a form with no submit button and more
 * than one text field doesn't submit on Enter (HTML implicit submission). This
 * button restores it: Enter submits through the form's own `onSubmit`.
 *
 * It's visually hidden rather than `display: none` (the conservative choice
 * for a button implicit submission has to find), and kept out of the tab
 * order and the accessibility tree. `Modal` renders it automatically when its
 * paper is a form; a raw MUI `Dialog` + `<form>` renders it inside the form.
 *
 * It carries `formNoValidate`: the dialog validates in its own `onSubmit`
 * (Zod + field errors), as a click on the visible submit does, so Enter must
 * reach it rather than stop at the browser's native `required` check.
 *
 * Pass `disabled` whenever the dialog's visible submit is disabled (a request
 * in flight, an incomplete form): a disabled default button blocks implicit
 * submission, so Enter can't do what the button can't.
 */
export interface FormDefaultButtonProps {
  disabled?: boolean;
}

export const FormDefaultButton: React.FC<FormDefaultButtonProps> = ({
  disabled = false,
}) => (
  <button
    type="submit"
    formNoValidate
    disabled={disabled}
    aria-hidden="true"
    tabIndex={-1}
    style={{
      position: "absolute",
      width: 1,
      height: 1,
      padding: 0,
      margin: -1,
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      border: 0,
    }}
  />
);

export default FormDefaultButton;
