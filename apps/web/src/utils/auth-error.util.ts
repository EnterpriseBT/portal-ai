type LogoutFn = () => void;
type NotInvitedFn = () => void;

let logoutFn: LogoutFn | null = null;
let notInvitedFn: NotInvitedFn | null = null;

/** #916: the API refuses an uninvited login through an invite-gated
 *  enterprise connection with this code. */
export const SSO_PROVISIONING_NOT_INVITED = "SSO_PROVISIONING_NOT_INVITED";

export const registerAuthLogout = (fn: LogoutFn): void => {
  logoutFn = fn;
};

export const handleAuthError = (): void => {
  if (logoutFn) {
    logoutFn();
  }
};

/** #916: registered by the root route, the first place with the router, so
 *  a refusal can send the caller to `/not-invited`. A no-op until then. */
export const registerNotInvitedHandler = (fn: NotInvitedFn): void => {
  notInvitedFn = fn;
};

export const handleNotInvited = (): void => {
  if (notInvitedFn) {
    notInvitedFn();
  }
};
