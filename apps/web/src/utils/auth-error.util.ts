type LogoutFn = () => void;

let logoutFn: LogoutFn | null = null;

export const registerAuthLogout = (fn: LogoutFn): void => {
  logoutFn = fn;
};

export const handleAuthError = (): void => {
  if (logoutFn) {
    logoutFn();
  }
};
