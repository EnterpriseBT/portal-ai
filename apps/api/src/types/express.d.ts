import {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";

/**
 * JWT token payload structure from Auth0
 */
export interface JwtPayload {
  /** Subject - typically the user ID */
  sub: string;
  /** Audience - the API identifier */
  aud: string | string[];
  /** Issuer - the Auth0 domain */
  iss: string;
  /** Issued at timestamp */
  iat: number;
  /** Expiration timestamp */
  exp: number;
  /** Granted scopes (space-separated string) */
  scope?: string;
  /** Permissions array (RBAC) */
  permissions?: string[];
  /** Any additional custom claims */
  [key: string]: unknown;
}

/**
 * Auth object added by express-oauth2-jwt-bearer middleware
 */
export interface AuthContext {
  /** Decoded JWT token payload */
  payload: JwtPayload;
  /** Authorization header value */
  header: string;
  /** Parsed JWT token */
  token: string;
}

declare global {
  namespace Express {
    /**
     * Extended Express Request with authentication context
     */
    interface Request {
      /** Authentication context populated by express-oauth2-jwt-bearer */
      auth?: AuthContext;
      rawBody?: Buffer; // For webhook signature verification
    }

    /**
     * Extended Express Response (placeholder for future extensions)
     */
    interface Response {
      // Add custom response properties here if needed
    }
  }
}

export {};
