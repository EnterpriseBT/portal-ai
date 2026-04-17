import { AsyncLocalStorage } from "node:async_hooks";
import type pino from "pino";

export interface RequestContext {
  log: pino.Logger;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
